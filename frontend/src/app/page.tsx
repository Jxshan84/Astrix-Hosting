export default function Home() {
  const features = [
    ["⚡", "Instant Deploy", "Deploy your bot/server quickly with a simple setup."],
    ["🖥️", "Live Console", "Monitor and control your running server in real time."],
    ["📁", "File Manager", "Manage, edit, upload and download your server files."],
    ["📊", "Live Monitoring", "View CPU, RAM, storage and server status."],
    ["💾", "Backups", "Keep server data protected with backup support."],
    ["🛡️", "Server Protection", "Isolated hosting with resource and abuse protection."],
    ["🔄", "Restart Controls", "Start, stop and restart your servers whenever needed."],
    ["🎮", "Multiple Runtimes", "Node.js, Python, Bun, Java, Lavalink and more."]
  ];

  const servers = [
    ["Node.js", "JavaScript / TypeScript", "nodedotjs", "68A063"],
    ["Python", "Python applications & bots", "python", "3776AB"],
    ["Bun", "Fast JavaScript runtime", "bun", "FFFFFF"],
    ["Lavalink", "Music infrastructure", "sonos", "FFFFFF"],
    ["Java", "Java applications & Minecraft", "openjdk", "FFFFFF"],
    ["Go", "Go applications", "go", "00ADD8"],
    ["Rust", "Rust applications", "rust", "FFFFFF"],
    ["PHP", "PHP applications", "php", "777BB4"],
    ["Deno", "Modern JavaScript runtime", "deno", "FFFFFF"],
    ["Ruby", "Ruby applications", "ruby", "CC342D"]
  ];

  const plans = [
    {
      name: "Free",
      price: "₹0",
      description: "Start hosting without paying.",
      items: ["1 Server", "512 MB RAM", "Basic CPU", "Basic Console", "Community Support"]
    },
    {
      name: "Starter",
      price: "₹49",
      description: "For small bots and projects.",
      items: ["2 Servers", "1 GB RAM", "Better CPU", "Console + Files", "Backups"]
    },
    {
      name: "Pro",
      price: "₹149",
      description: "For serious projects and communities.",
      items: ["5 Servers", "4 GB RAM", "Priority Resources", "Backups", "Priority Support"]
    },
    {
      name: "Premium",
      price: "₹299",
      description: "Maximum hosting features.",
      items: ["10 Servers", "8 GB RAM", "High Resources", "Advanced Features", "24/7 Priority Support"]
    }
  ];

  return (
    <main className="home-page">
      <div className="wildlife-scene" aria-hidden="true" />

      <nav className="home-nav">
        <a href="/" className="brand">🌿 ASTRIX HOSTING</a>

        <div className="nav-links">
          <a href="#status">Status</a>
          <a href="#features">Features</a>
          <a href="#servers">Servers</a>
          <a href="#plans">Plans</a>
          <a href="#support">Support</a>
          <a href="/login">Login</a>
        </div>
      </nav>

      <section className="hero-section">
        <div className="hero-badge">✦ NEXT-GENERATION BOT HOSTING</div>

        <h1>
          Host beyond
          <span> limits.</span>
        </h1>

        <p>
          Fast, reliable and powerful hosting for your Discord bots,
          applications and servers. Deploy your server and let Astrix
          handle the rest.
        </p>

        <div className="hero-actions">
          <a href="/login" className="primary-button">Start Hosting →</a>
          <a href="#plans" className="secondary-button">View Plans</a>
        </div>
      </section>

      <section id="status" className="site-section">
        <div className="section-heading">
          <span>ASTRIX STATUS</span>
          <h2>Everything looks healthy.</h2>
          <p>Current Astrix Hosting service status.</p>
        </div>

        <div className="status-grid">
          {[
            ["Website", "Operational"],
            ["Hosting API", "Operational"],
            ["Server Management", "Operational"],
            ["Online Support", "Available"]
          ].map(([name, status]) => (
            <div className="status-card" key={name}>
              <div>
                <strong>{name}</strong>
                <small>{status}</small>
              </div>
              <span className="status-dot" />
            </div>
          ))}
        </div>
      </section>

      <section id="features" className="site-section">
        <div className="section-heading">
          <span>BUILT FOR CREATORS</span>
          <h2>Everything your servers need.</h2>
          <p>Powerful tools without unnecessary complexity.</p>
        </div>

        <div className="feature-grid">
          {features.map(([icon, title, description]) => (
            <article className="feature-card" key={title}>
              <div className="feature-icon">{icon}</div>
              <h3>{title}</h3>
              <p>{description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="servers" className="site-section">
        <div className="section-heading">
          <span>SERVER TYPES</span>
          <h2>Run what you build.</h2>
          <p>Choose the runtime that matches your project.</p>
        </div>

        <div className="server-grid">
          {servers.map(([name, description, icon, color]) => (
            <article className="server-type-card" key={name}>
              <img
                src={`https://cdn.simpleicons.org/${icon}/${color}`}
                alt=""
              />
              <div>
                <h3>{name}</h3>
                <p>{description}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="plans" className="site-section">
        <div className="section-heading">
          <span>HOSTING PLANS</span>
          <h2>Choose your resources.</h2>
          <p>Start free and upgrade when your project grows.</p>
        </div>

        <div className="plans-grid">
          {plans.map((plan, index) => (
            <article
              className={`plan-card ${index === 2 ? "plan-featured" : ""}`}
              key={plan.name}
            >
              {index === 2 && <div className="plan-label">POPULAR</div>}

              <h3>{plan.name}</h3>
              <div className="plan-price">
                {plan.price}<small>/month</small>
              </div>

              <p>{plan.description}</p>

              <ul>
                {plan.items.map(item => (
                  <li key={item}>✓ {item}</li>
                ))}
              </ul>

              <a href="/login" className="plan-button">
                Get Started
              </a>
            </article>
          ))}
        </div>
      </section>

      <section id="support" className="site-section support-section">
        <div className="support-card">
          <div>
            <span>ONLINE SUPPORT</span>
            <h2>Need help with your server?</h2>
            <p>
              Contact our support team for hosting problems, setup help,
              account issues and technical questions.
            </p>

            <div className="support-hours">
              <strong>Support hours</strong>
              <span>09:00 – 21:00 IST</span>
            </div>
          </div>

          <div className="support-actions">
            <a
              href="https://discord.gg/3B5PF9SC8j"
              target="_blank"
              rel="noreferrer"
              className="primary-button"
            >
              Support Discord
            </a>

            <a href="mailto:sasukeuchicha46535@gmail.com" className="secondary-button">
              Contact Support
            </a>
          </div>
        </div>

        <div className="support-grid">
          <a
            href="https://discord.gg/3B5PF9SC8j"
            target="_blank"
            rel="noreferrer"
            className="support-mini-card"
          >
            <strong>💬 Support Tickets</strong>
            <span>Open a support request through Discord.</span>
          </a>

          <a
            href="https://discord.gg/3B5PF9SC8j"
            target="_blank"
            rel="noreferrer"
            className="support-mini-card"
          >
            <strong>🐛 Bug Reports</strong>
            <span>Report bugs and technical problems.</span>
          </a>

          <a
            href="https://discord.gg/3B5PF9SC8j"
            target="_blank"
            rel="noreferrer"
            className="support-mini-card"
          >
            <strong>⭐ Premium Support</strong>
            <span>Priority assistance for premium users.</span>
          </a>
        </div>
      </section>

      <section className="final-cta">
        <span>READY TO HOST?</span>
        <h2>Build it. Deploy it. Astrix it.</h2>
        <p>Create your first server and start hosting.</p>
        <a href="/login" className="primary-button">Start Hosting →</a>
      </section>

      <footer className="home-footer">
        <div>
          <strong>ASTRIX HOSTING</strong>
          <p>Owner: Jashan Deep Singh</p>
          <p>Discord: jxshan84</p>
          <p>Email: sasukeuchicha46535@gmail.com</p>
        </div>

        <div className="footer-links">
          <a href="https://discord.gg/3B5PF9SC8j" target="_blank" rel="noreferrer">
            Support Discord
          </a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
          <span>© 2026 Astrix Hosting</span>
        </div>
      </footer>

      <style>{`
        .home-page {
          position: relative;
          min-height: 100vh;
          overflow: hidden;
        }

        .home-page > *:not(.wildlife-scene) {
          position: relative;
          z-index: 2;
        }

        .home-nav {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 20px;
          padding: 20px 6%;
          border-bottom: 1px solid rgba(155,255,200,.10);
          background: rgba(2,8,5,.38);
          backdrop-filter: blur(12px);
        }

        .brand {
          color: #dfffe8;
          text-decoration: none;
          font-weight: 800;
          letter-spacing: .05em;
          font-size: 13px;
        }

        .nav-links {
          display: flex;
          gap: 22px;
          flex-wrap: wrap;
        }

        .nav-links a {
          color: #a4b5aa;
          text-decoration: none;
          font-size: 13px;
        }

        .nav-links a:hover {
          color: #c9ffda;
        }

        .hero-section {
          max-width: 900px;
          margin: 0 auto;
          padding: 110px 6% 120px;
          text-align: left;
        }

        .hero-badge,
        .section-heading > span,
        .support-card > div > span,
        .final-cta > span {
          color: #9be7ad;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: .12em;
        }

        .hero-section h1 {
          margin: 18px 0;
          font-size: clamp(52px, 9vw, 100px);
          line-height: .95;
          letter-spacing: -.06em;
        }

        .hero-section h1 span {
          color: #9be7ad;
        }

        .hero-section > p {
          max-width: 620px;
          color: #b3c2b8;
          line-height: 1.7;
          font-size: 16px;
        }

        .hero-actions,
        .support-actions {
          display: flex;
          gap: 12px;
          flex-wrap: wrap;
          margin-top: 28px;
        }

        .primary-button,
        .secondary-button,
        .plan-button {
          display: inline-flex;
          justify-content: center;
          align-items: center;
          min-height: 46px;
          padding: 11px 18px;
          border-radius: 12px;
          text-decoration: none;
          font-size: 13px;
          font-weight: 800;
          transition: .4s ease;
        }

        .primary-button {
          color: #061009;
          background: #9be7ad;
        }

        .primary-button:hover {
          transform: translateY(-2px);
          background: #b5f7c4;
          box-shadow: 0 12px 30px rgba(0,0,0,.35);
        }

        .secondary-button,
        .plan-button {
          color: #e9fff0;
          background: rgba(8,20,13,.90);
          border: 1px solid rgba(155,255,200,.17);
        }

        .secondary-button:hover,
        .plan-button:hover {
          transform: translateY(-2px);
          background: rgba(24,54,37,.96);
          border-color: rgba(155,255,200,.30);
        }

        .site-section {
          max-width: 1180px;
          margin: 0 auto;
          padding: 90px 6%;
        }

        .section-heading {
          margin-bottom: 32px;
        }

        .section-heading h2,
        .support-card h2,
        .final-cta h2 {
          margin: 10px 0;
          font-size: clamp(30px, 5vw, 52px);
          letter-spacing: -.04em;
        }

        .section-heading p,
        .support-card p,
        .final-cta p {
          color: #9cad9f;
          line-height: 1.6;
        }

        .status-grid,
        .feature-grid,
        .server-grid,
        .plans-grid,
        .support-grid {
          display: grid;
          gap: 14px;
        }

        .status-grid {
          grid-template-columns: repeat(4, 1fr);
        }

        .status-card,
        .feature-card,
        .server-type-card,
        .plan-card,
        .support-mini-card,
        .support-card {
          border: 1px solid rgba(155,255,200,.12);
          background: rgba(5,14,9,.82);
          box-shadow: 0 16px 45px rgba(0,0,0,.25);
          backdrop-filter: blur(16px);
        }

        .status-card {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 20px;
          border-radius: 15px;
        }

        .status-card strong,
        .status-card small {
          display: block;
        }

        .status-card small {
          margin-top: 6px;
          color: #9be7ad;
          font-size: 12px;
        }

        .status-dot {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: #7ff0a0;
          box-shadow: 0 0 14px rgba(127,240,160,.65);
        }

        .feature-grid {
          grid-template-columns: repeat(4, 1fr);
        }

        .feature-card {
          min-height: 180px;
          padding: 24px;
          border-radius: 18px;
        }

        .feature-icon {
          font-size: 25px;
        }

        .feature-card h3,
        .server-type-card h3,
        .plan-card h3 {
          margin: 18px 0 8px;
        }

        .feature-card p,
        .server-type-card p,
        .plan-card p,
        .support-mini-card span {
          color: #91a49a;
          font-size: 13px;
          line-height: 1.6;
        }

        .server-grid {
          grid-template-columns: repeat(5, 1fr);
        }

        .server-type-card {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 17px;
          border-radius: 15px;
        }

        .server-type-card img {
          width: 30px;
          height: 30px;
          object-fit: contain;
        }

        .server-type-card h3 {
          margin: 0 0 4px;
          font-size: 14px;
        }

        .server-type-card p {
          margin: 0;
          font-size: 11px;
        }

        .plans-grid {
          grid-template-columns: repeat(4, 1fr);
          align-items: stretch;
        }

        .plan-card {
          position: relative;
          padding: 28px;
          border-radius: 20px;
        }

        .plan-featured {
          border-color: rgba(155,255,200,.32);
          box-shadow: 0 20px 55px rgba(0,0,0,.35);
        }

        .plan-label {
          position: absolute;
          top: 15px;
          right: 15px;
          padding: 5px 8px;
          border-radius: 999px;
          background: #193f2d;
          color: #9be7ad;
          font-size: 9px;
          font-weight: 900;
        }

        .plan-price {
          margin: 15px 0 8px;
          font-size: 34px;
          font-weight: 800;
        }

        .plan-price small {
          color: #74867b;
          font-size: 11px;
          font-weight: 500;
        }

        .plan-card ul {
          list-style: none;
          padding: 0;
          margin: 22px 0;
        }

        .plan-card li {
          padding: 7px 0;
          color: #b6c8bb;
          font-size: 12px;
        }

        .plan-button {
          width: 100%;
        }

        .support-card {
          display: flex;
          justify-content: space-between;
          gap: 30px;
          padding: 36px;
          border-radius: 24px;
        }

        .support-hours {
          display: flex;
          gap: 10px;
          margin-top: 20px;
          color: #aabcb0;
          font-size: 13px;
        }

        .support-hours strong {
          color: #e8fff0;
        }

        .support-grid {
          grid-template-columns: repeat(3, 1fr);
          margin-top: 14px;
        }

        .support-mini-card {
          padding: 22px;
          border-radius: 17px;
          text-decoration: none;
        }

        .support-mini-card strong,
        .support-mini-card span {
          display: block;
        }

        .support-mini-card span {
          margin-top: 8px;
        }

        .final-cta {
          max-width: 900px;
          margin: 60px auto 0;
          padding: 100px 6%;
          text-align: center;
        }

        .final-cta p {
          margin-bottom: 25px;
        }

        .home-footer {
          display: flex;
          justify-content: space-between;
          gap: 30px;
          padding: 40px 6%;
          border-top: 1px solid rgba(255,255,255,.10);
          background: rgba(2,7,4,.78);
        }

        .home-footer strong {
          letter-spacing: .08em;
        }

        .home-footer p {
          margin: 7px 0;
          color: #84968b;
          font-size: 12px;
        }

        .footer-links {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 18px;
          flex-wrap: wrap;
          color: #82958a;
          font-size: 12px;
        }

        .footer-links a {
          color: #9be7ad;
          text-decoration: none;
        }

        @media (max-width: 900px) {
          .status-grid,
          .feature-grid,
          .plans-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .server-grid {
            grid-template-columns: repeat(2, 1fr);
          }

          .support-card {
            flex-direction: column;
          }
        }

        @media (max-width: 600px) {
          .home-nav {
            align-items: flex-start;
            flex-direction: column;
          }

          .nav-links {
            gap: 13px;
          }

          .hero-section {
            padding-top: 75px;
            padding-bottom: 75px;
          }

          .hero-section h1 {
            font-size: 54px;
          }

          .status-grid,
          .feature-grid,
          .server-grid,
          .plans-grid,
          .support-grid {
            grid-template-columns: 1fr;
          }

          .site-section {
            padding-top: 65px;
            padding-bottom: 65px;
          }

          .home-footer {
            flex-direction: column;
          }

          .footer-links {
            justify-content: flex-start;
          }
        }
      `}</style>
    </main>
  );
}
