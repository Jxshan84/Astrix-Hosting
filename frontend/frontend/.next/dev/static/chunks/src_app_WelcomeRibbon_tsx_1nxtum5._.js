(globalThis["TURBOPACK"] || (globalThis["TURBOPACK"] = [])).push([typeof document === "object" ? document.currentScript : undefined,
"[project]/src/app/WelcomeRibbon.tsx [app-client] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>WelcomeRibbon
]);
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/jsx-dev-runtime.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/client/app-dir/link.js [app-client] (ecmascript)");
var __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/node_modules/next/dist/compiled/react/index.js [app-client] (ecmascript)");
;
var _s = __turbopack_context__.k.signature();
"use client";
;
;
;
const dismissedKey = "astrix-welcome-ribbon-dismissed";
function WelcomeRibbon() {
    _s();
    const [campaign, setCampaign] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [visible, setVisible] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [revealed, setRevealed] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [authenticated, setAuthenticated] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [eligible, setEligible] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [claim, setClaim] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(null);
    const [claiming, setClaiming] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])(false);
    const [error, setError] = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useState"])("");
    const swipeStart = (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useRef"])(null);
    (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$index$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["useEffect"])({
        "WelcomeRibbon.useEffect": ()=>{
            let active = true;
            void Promise.all([
                fetch("/api/welcome/campaign", {
                    cache: "no-store"
                }),
                fetch("/api/welcome/claim", {
                    cache: "no-store"
                })
            ]).then({
                "WelcomeRibbon.useEffect": async ([campaignResponse, claimResponse])=>{
                    if (!campaignResponse.ok) return;
                    const campaignData = await campaignResponse.json();
                    const claimData = claimResponse.ok ? await claimResponse.json() : null;
                    if (!active) return;
                    setCampaign(campaignData.campaign);
                    setAuthenticated(Boolean(claimData));
                    setEligible(claimData?.eligible === true);
                    setClaim(claimData?.claim ?? null);
                    if (claimData?.claim) {
                        try {
                            window.localStorage.setItem(dismissedKey, "1");
                        } catch  {
                        // The server claim remains authoritative when browser storage is unavailable.
                        }
                        return;
                    }
                    let dismissed = false;
                    try {
                        dismissed = window.localStorage.getItem(dismissedKey) === "1";
                    } catch  {
                        dismissed = false;
                    }
                    setVisible(campaignData.campaign.claimsOpen && !dismissed);
                }
            }["WelcomeRibbon.useEffect"]).catch({
                "WelcomeRibbon.useEffect": ()=>{
                    if (active) setCampaign(null);
                }
            }["WelcomeRibbon.useEffect"]);
            return ({
                "WelcomeRibbon.useEffect": ()=>{
                    active = false;
                }
            })["WelcomeRibbon.useEffect"];
        }
    }["WelcomeRibbon.useEffect"], []);
    function dismiss() {
        try {
            window.localStorage.setItem(dismissedKey, "1");
        } catch  {
        // Dismissal is a convenience, not proof of reward eligibility.
        }
        setVisible(false);
    }
    function reveal() {
        setRevealed(true);
        try {
            window.localStorage.setItem(dismissedKey, "1");
        } catch  {
        // The website remains usable without browser storage.
        }
    }
    function startSlice(event) {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        swipeStart.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    }
    function finishSlice(event) {
        const start = swipeStart.current;
        swipeStart.current = null;
        if (!start || start.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - start.x;
        const deltaY = event.clientY - start.y;
        if (deltaX >= 56 && deltaX > Math.abs(deltaY)) reveal();
    }
    async function claimReward() {
        setClaiming(true);
        setError("");
        try {
            const response = await fetch("/api/welcome/claim", {
                method: "POST",
                credentials: "include"
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || "Unable to claim this reward.");
            setClaim(data.claim);
        } catch (claimError) {
            setError(claimError instanceof Error ? claimError.message : "Unable to claim this reward.");
        } finally{
            setClaiming(false);
        }
    }
    if (!visible || !campaign?.claimsOpen) return null;
    return /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("section", {
        className: `welcome-ribbon ${revealed ? "is-revealed" : ""}`,
        "aria-labelledby": "welcome-title",
        children: [
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                className: "welcome-dismiss",
                type: "button",
                onClick: dismiss,
                "aria-label": "Dismiss welcome reward",
                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                    "aria-hidden": "true",
                    children: "×"
                }, void 0, false, {
                    fileName: "[project]/src/app/WelcomeRibbon.tsx",
                    lineNumber: 145,
                    columnNumber: 9
                }, this)
            }, void 0, false, {
                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                lineNumber: 144,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: "welcome-copy",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "welcome-eyebrow",
                        children: "A SMALL GIFT FROM ASTRIX"
                    }, void 0, false, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 148,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("h1", {
                        id: "welcome-title",
                        children: "Welcome to Astrix Hosting."
                    }, void 0, false, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 149,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                        children: "Every new project deserves a golden start. There is a welcome reward tucked inside."
                    }, void 0, false, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 150,
                        columnNumber: 9
                    }, this),
                    !revealed ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["Fragment"], {
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                className: "welcome-cut-button welcome-slice-button",
                                type: "button",
                                onClick: reveal,
                                onPointerDown: startSlice,
                                onPointerUp: finishSlice,
                                onPointerCancel: ()=>{
                                    swipeStart.current = null;
                                },
                                "aria-describedby": "welcome-slice-hint",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                        "aria-hidden": "true",
                                        children: "✂"
                                    }, void 0, false, {
                                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                        lineNumber: 162,
                                        columnNumber: 15
                                    }, this),
                                    " Cut the Ribbon"
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 153,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "welcome-slice-hint",
                                id: "welcome-slice-hint",
                                children: "Tap to cut, or swipe right across the button."
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 164,
                                columnNumber: 13
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 152,
                        columnNumber: 11
                    }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                        className: "welcome-reward",
                        "aria-live": "polite",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "welcome-reward-label",
                                children: "YOUR WELCOME REWARD"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 170,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("strong", {
                                children: "Your Astrix welcome collection"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 171,
                                columnNumber: 13
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("ul", {
                                className: "welcome-reward-list",
                                children: campaign.rewards.map((reward)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("li", {
                                        children: [
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                "aria-hidden": "true",
                                                children: reward.type === "badge" ? "✦" : "◆"
                                            }, void 0, false, {
                                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                                lineNumber: 175,
                                                columnNumber: 19
                                            }, this),
                                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                                children: [
                                                    reward.name,
                                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("small", {
                                                        children: reward.type
                                                    }, void 0, false, {
                                                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                                        lineNumber: 176,
                                                        columnNumber: 38
                                                    }, this)
                                                ]
                                            }, void 0, true, {
                                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                                lineNumber: 176,
                                                columnNumber: 19
                                            }, this)
                                        ]
                                    }, reward.id, true, {
                                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                        lineNumber: 174,
                                        columnNumber: 17
                                    }, this))
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 172,
                                columnNumber: 13
                            }, this),
                            claim ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "welcome-code",
                                children: /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                    children: "Your welcome rewards are attached to this account."
                                }, void 0, false, {
                                    fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                    lineNumber: 182,
                                    columnNumber: 17
                                }, this)
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 181,
                                columnNumber: 15
                            }, this) : authenticated ? eligible ? /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("button", {
                                className: "welcome-cut-button",
                                type: "button",
                                onClick: ()=>void claimReward(),
                                disabled: claiming,
                                children: claiming ? "Claiming..." : "Claim my rewards"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 186,
                                columnNumber: 17
                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "welcome-terms",
                                children: "This account is not eligible for this promotion."
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 189,
                                columnNumber: 19
                            }, this) : /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                                className: "welcome-actions",
                                children: [
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                        href: "/register?welcome=claim",
                                        className: "welcome-cut-button",
                                        children: "Create account to claim"
                                    }, void 0, false, {
                                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                        lineNumber: 192,
                                        columnNumber: 17
                                    }, this),
                                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])(__TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$client$2f$app$2d$dir$2f$link$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["default"], {
                                        href: "/login?welcome=claim",
                                        className: "welcome-login-link",
                                        children: "Already have an account? Sign in"
                                    }, void 0, false, {
                                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                        lineNumber: 193,
                                        columnNumber: 17
                                    }, this)
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 191,
                                columnNumber: 15
                            }, this),
                            error && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "welcome-error",
                                role: "alert",
                                children: error
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 196,
                                columnNumber: 23
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "welcome-terms",
                                children: [
                                    "For new, unrestricted accounts. One claim per account.",
                                    campaign.redemptionLimit ? ` Limited to ${campaign.redemptionLimit} account(s).` : " No account claim limit is set.",
                                    campaign.expiresAt ? ` Promotion ends ${new Date(campaign.expiresAt).toLocaleString()}.` : " No expiry is currently set."
                                ]
                            }, void 0, true, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 197,
                                columnNumber: 13
                            }, this),
                            !campaign.checkoutConfigured && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("p", {
                                className: "welcome-checkout-note",
                                children: "Discount coupons are not offered because checkout cannot currently redeem them."
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 203,
                                columnNumber: 15
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 169,
                        columnNumber: 11
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                lineNumber: 147,
                columnNumber: 7
            }, this),
            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("div", {
                className: `welcome-gift ${revealed ? "gift-open" : ""}`,
                "aria-hidden": "true",
                children: [
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "gift-spark gift-spark-one"
                    }, void 0, false, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 209,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "gift-spark gift-spark-two"
                    }, void 0, false, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 210,
                        columnNumber: 9
                    }, this),
                    /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "gift-box",
                        children: [
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "gift-box-front"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 212,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "gift-lid"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 213,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "gift-ribbon-vertical"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 214,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "gift-ribbon-horizontal"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 215,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "gift-bow gift-bow-left"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 216,
                                columnNumber: 11
                            }, this),
                            /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                                className: "gift-bow gift-bow-right"
                            }, void 0, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 217,
                                columnNumber: 11
                            }, this)
                        ]
                    }, void 0, true, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 211,
                        columnNumber: 9
                    }, this),
                    revealed && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "welcome-slice-line"
                    }, void 0, false, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 219,
                        columnNumber: 22
                    }, this),
                    revealed && /*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("span", {
                        className: "welcome-confetti",
                        children: Array.from({
                            length: 14
                        }, (_, index)=>/*#__PURE__*/ (0, __TURBOPACK__imported__module__$5b$project$5d2f$node_modules$2f$next$2f$dist$2f$compiled$2f$react$2f$jsx$2d$dev$2d$runtime$2e$js__$5b$app$2d$client$5d$__$28$ecmascript$29$__["jsxDEV"])("i", {}, index, false, {
                                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                                lineNumber: 220,
                                columnNumber: 99
                            }, this))
                    }, void 0, false, {
                        fileName: "[project]/src/app/WelcomeRibbon.tsx",
                        lineNumber: 220,
                        columnNumber: 22
                    }, this)
                ]
            }, void 0, true, {
                fileName: "[project]/src/app/WelcomeRibbon.tsx",
                lineNumber: 208,
                columnNumber: 7
            }, this)
        ]
    }, void 0, true, {
        fileName: "[project]/src/app/WelcomeRibbon.tsx",
        lineNumber: 143,
        columnNumber: 5
    }, this);
}
_s(WelcomeRibbon, "aw5cLWFlrGpwTQa4oVVgr+FhVpQ=");
_c = WelcomeRibbon;
var _c;
__turbopack_context__.k.register(_c, "WelcomeRibbon");
if (typeof globalThis.$RefreshHelpers$ === 'object' && globalThis.$RefreshHelpers !== null) {
    __turbopack_context__.k.registerExports(__turbopack_context__.m, globalThis.$RefreshHelpers$);
}
}),
]);

//# sourceMappingURL=src_app_WelcomeRibbon_tsx_1nxtum5._.js.map