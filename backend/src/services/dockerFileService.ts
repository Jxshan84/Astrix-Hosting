import { spawn } from "node:child_process";

const containerRoot = "/home/container";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_EDIT_BYTES = 1024 * 1024;
const maxListingBytes = 2 * 1024 * 1024;
const maxFileNameBytes = 255;
const textFileNames = new Set([
  "Dockerfile",
  "package.json",
  "index.js",
  "index.ts",
  "requirements.txt",
]);
const textExtensions = new Set([
  ".c",
  ".cfg",
  ".conf",
  ".css",
  ".go",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".sh",
  ".sql",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);

const pathGuard = `
set -f
root=${containerRoot}
[ ! -L "$root" ] || { echo "Server file volume is unavailable." >&2; exit 74; }
mkdir -p -- "$root" || { echo "Server file volume is unavailable." >&2; exit 74; }
check_path() {
  relative=$1
  [ -z "$relative" ] && return 0
  current=$root
  old_ifs=$IFS
  IFS=/
  for component in $relative; do
    [ -n "$component" ] || continue
    current="$current/$component"
    if [ -L "$current" ]; then
      IFS=$old_ifs
      echo "File operations through symbolic links are not allowed." >&2
      return 1
    fi
  done
  IFS=$old_ifs
}
check_path "$1" || exit 73
target="$root/$1"
`;

function validateRelativePath(path: string, allowRoot = false) {
  if (allowRoot && path === "") return;
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 1024 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.includes("\0")
  ) {
    throw new TypeError("Use a relative file path inside the server directory.");
  }
  const components = path.split("/");
  if (components.some((component) => !component || component === "." || component === "..")) {
    throw new TypeError("File paths cannot contain empty, current, or parent directory segments.");
  }
  if (components.some((component) => Buffer.byteLength(component, "utf8") > maxFileNameBytes)) {
    throw new TypeError("File path components cannot exceed 255 bytes.");
  }
}

function runDocker(
  args: string[],
  options: { input?: Buffer; maxOutputBytes?: number } = {}
): Promise<Buffer> {
  const maxOutputBytes = options.maxOutputBytes ?? maxListingBytes;
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, {
      stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      finish(new Error("Docker file operation timed out."));
    }, 30_000);

    function finish(error?: Error, result?: Buffer) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(result ?? Buffer.alloc(0));
    }

    if (!child.stdout || !child.stderr || !child.stdin) {
      child.kill("SIGKILL");
      finish(new Error("Unable to open Docker process streams."));
      return;
    }

    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        child.kill("SIGKILL");
        finish(new Error("The requested server file operation exceeded its size limit."));
      } else {
        stdout.push(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      errorBytes += chunk.length;
      if (errorBytes <= 64 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code === 0) {
        finish(undefined, Buffer.concat(stdout, outputBytes));
      } else {
        const message = Buffer.concat(stderr, errorBytes).toString("utf8").trim();
        finish(new Error(message || `Docker file operation failed (exit ${code ?? "unknown"}).`));
      }
    });
    if (options.input) child.stdin.end(options.input);
  });
}

function dockerArgs(serverId: string, script: string, args: string[]) {
  return ["exec", "-i", `astrix-${serverId}`, "sh", "-c", script, "astrix-files", ...args];
}

export type ServerFile = {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modifiedAt: string | null;
};

export function parseDirectoryListing(output: Buffer, directory: string): ServerFile[] {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(output);
  if (!text) return [];
  return text.split("\n").filter(Boolean).map((line) => {
    const [encodedName, type, sizeRaw, modifiedRaw] = line.split("\t");
    if (!encodedName || !["file", "directory", "symlink"].includes(type)) {
      throw new Error("Docker returned an invalid file listing.");
    }
    const name = Buffer.from(encodedName, "base64").toString("utf8");
    if (!name || name.includes("/") || name === "." || name === "..") {
      throw new Error("Docker returned an invalid file name.");
    }
    const size = Number(sizeRaw);
    const modified = Number(modifiedRaw);
    return {
      name,
      path: directory ? `${directory}/${name}` : name,
      type: type as ServerFile["type"],
      size: Number.isSafeInteger(size) && size >= 0 ? size : 0,
      modifiedAt: Number.isFinite(modified) && modified > 0
        ? new Date(modified * 1000).toISOString()
        : null,
    };
  });
}

export async function listFiles(serverId: string, directory: string): Promise<ServerFile[]> {
  validateRelativePath(directory, true);
  const script = `${pathGuard}
[ -d "$target" ] || { echo "Directory not found." >&2; exit 66; }
for entry in "$target"/* "$target"/.[!.]* "$target"/..?*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  name=\${entry##*/}
  encoded=$(printf '%s' "$name" | base64 | tr -d '\\n') || exit 74
  if [ -L "$entry" ]; then type=symlink
  elif [ -d "$entry" ]; then type=directory
  else type=file
  fi
  size=$(stat -c '%s' "$entry" 2>/dev/null || printf '0')
  modified=$(stat -c '%Y' "$entry" 2>/dev/null || printf '0')
  printf '%s\\t%s\\t%s\\t%s\\n' "$encoded" "$type" "$size" "$modified"
done
`;
  const output = await runDocker(dockerArgs(serverId, script, [directory]));
  return parseDirectoryListing(output, directory);
}

export function isTextFile(path: string) {
  const name = path.split("/").at(-1) || "";
  const extension = name.includes(".") ? `.${name.split(".").at(-1)!.toLowerCase()}` : "";
  return textFileNames.has(name) || textExtensions.has(extension);
}

export async function readTextFile(serverId: string, path: string): Promise<string> {
  validateRelativePath(path);
  if (!isTextFile(path)) throw new TypeError("This file type is not available in the text editor.");
  const script = `${pathGuard}
[ -f "$target" ] || { echo "File not found." >&2; exit 66; }
[ "$(wc -c < "$target")" -le ${MAX_EDIT_BYTES} ] || { echo "Text file exceeds the editor size limit." >&2; exit 75; }
cat -- "$target"
`;
  const output = await runDocker(dockerArgs(serverId, script, [path]), {
    maxOutputBytes: MAX_EDIT_BYTES,
  });
  return new TextDecoder("utf-8", { fatal: true }).decode(output);
}

export async function downloadFile(serverId: string, path: string): Promise<Buffer> {
  validateRelativePath(path);
  const script = `${pathGuard}
[ -f "$target" ] || { echo "File not found." >&2; exit 66; }
[ "$(wc -c < "$target")" -le ${MAX_UPLOAD_BYTES} ] || { echo "File exceeds the download size limit." >&2; exit 75; }
cat -- "$target"
`;
  return runDocker(dockerArgs(serverId, script, [path]), {
    maxOutputBytes: MAX_UPLOAD_BYTES,
  });
}

export async function writeFile(
  serverId: string,
  path: string,
  content: Buffer,
  overwrite = false
) {
  validateRelativePath(path);
  if (content.length > MAX_UPLOAD_BYTES) {
    throw new RangeError(`Files cannot exceed ${MAX_UPLOAD_BYTES} bytes.`);
  }
  const script = `${pathGuard}
parent=\${target%/*}
[ -d "$parent" ] || { echo "Parent directory not found." >&2; exit 66; }
if [ -e "$target" ] || [ -L "$target" ]; then
  [ "$2" = "true" ] || { echo "File already exists; explicit overwrite confirmation is required." >&2; exit 73; }
  [ -f "$target" ] || { echo "The target is not a regular file." >&2; exit 73; }
fi
cat > "$target"
`;
  await runDocker(dockerArgs(serverId, script, [path, overwrite ? "true" : "false"]), {
    input: content,
    maxOutputBytes: 64 * 1024,
  });
}

export async function writeTextFile(
  serverId: string,
  path: string,
  content: string,
  overwrite = false
) {
  if (!isTextFile(path)) throw new TypeError("This file type is not available in the text editor.");
  const data = Buffer.from(content, "utf8");
  if (data.length > MAX_EDIT_BYTES) {
    throw new RangeError(`Text files cannot exceed ${MAX_EDIT_BYTES} bytes in the editor.`);
  }
  await writeFile(serverId, path, data, overwrite);
}

export async function createDirectory(serverId: string, path: string) {
  validateRelativePath(path);
  const script = `${pathGuard}
parent=\${target%/*}
[ -d "$parent" ] || { echo "Parent directory not found." >&2; exit 66; }
[ ! -e "$target" ] && [ ! -L "$target" ] || { echo "A file or directory with that name already exists." >&2; exit 73; }
mkdir -- "$target"
`;
  await runDocker(dockerArgs(serverId, script, [path]), { maxOutputBytes: 64 * 1024 });
}

export async function renamePath(
  serverId: string,
  fromPath: string,
  toPath: string,
  overwrite = false
) {
  validateRelativePath(fromPath);
  validateRelativePath(toPath);
  if (toPath.startsWith(`${fromPath}/`)) {
    throw new TypeError("A directory cannot be moved inside itself.");
  }
  const script = `${pathGuard}
source="$root/$1"
destination="$root/$2"
check_path "$2" || exit 73
parent=\${destination%/*}
[ -e "$source" ] || { echo "Source path not found." >&2; exit 66; }
[ -d "$parent" ] || { echo "Destination parent directory not found." >&2; exit 66; }
if [ -e "$destination" ] || [ -L "$destination" ]; then
  [ "$3" = "true" ] || { echo "Destination already exists; explicit overwrite confirmation is required." >&2; exit 73; }
  rm -rf -- "$destination"
fi
mv -- "$source" "$destination"
`;
  await runDocker(dockerArgs(serverId, script, [
    fromPath,
    toPath,
    overwrite ? "true" : "false",
  ]), { maxOutputBytes: 64 * 1024 });
}

export async function deletePath(serverId: string, path: string) {
  validateRelativePath(path);
  const script = `${pathGuard}
[ -e "$target" ] || { echo "File or directory not found." >&2; exit 66; }
rm -rf -- "$target"
`;
  await runDocker(dockerArgs(serverId, script, [path]), { maxOutputBytes: 64 * 1024 });
}

export function validateFilePath(path: string, allowRoot = false) {
  validateRelativePath(path, allowRoot);
}
