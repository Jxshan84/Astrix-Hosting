"use client";

import { useState } from "react";
export default function Home() {
  const [showHosting, setShowHosting] = useState(false);

  return (
    <main style={{
      minHeight: "100vh",
      background: "linear-gradient(rgba(3,12,8,.62),rgba(3,12,8,.88)), url(\"https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=2400&q=85\")",
      color: "white",
      padding: "30px",
      fontFamily: "Arial, sans-serif"
    }}>
      <div className="wildlife-scene" />
      <nav style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "15px 5%",
        borderBottom: "1px solid #ffffff20"
      }}>
        <h2>🌿 ASTRIX <small>HOSTING</small></h2>
        <div>Servers　 Features　 Plans　 <button>Login</button></div>
      </nav>

      <section style={{
        minHeight: "550px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-around",
        flexWrap: "wrap",
        gap: "40px",
        padding: "60px 5%"
      }}>
        <div style={{maxWidth:"600px"}}>
          <p style={{color:"#9be7ad"}}>✦ NEXT-GENERATION BOT HOSTING</p>

          <h1 style={{
            fontSize:"clamp(55px,9vw,100px)",
            lineHeight:".9",
            margin:"20px 0"
          }}>
            Host beyond
            <br />
            <span style={{color:"#9be7ad"}}>limits.</span>
          </h1>

          <p style={{
            color:"#a5b5ad",
            fontSize:"18px",
            lineHeight:"1.7"
          }}>
            Fast, reliable and powerful hosting for your Discord bots.
            Deploy your server and let Astrix handle the rest.
          </p>

          <button onClick={() => setShowHosting(true)} style={{
        marginTop:"20px",
        padding:"15px 24px",
        border:0,
        borderRadius:"10px",
        background:"#a8eabb",
        fontWeight:"bold",
        cursor:"pointer"
      }}>
            Start Hosting →
          </button>
        </div>

        <div style={{
          width:"330px",
          padding:"25px",
          borderRadius:"20px",
          background:"#071810dd",
          border:"1px solid #ffffff20",
          boxShadow:"0 20px 70px #000"
        }}>
          <small style={{color:"#71877b"}}>MY SERVER</small>
          <h2>Astrix Bot #01</h2>
          <p style={{color:"#91e5a5"}}>● ONLINE</p>

          <div style={{marginTop:"30px"}}>
            <p>CPU <b style={{float:"right"}}>12%</b></p>
            <hr />
            <p>RAM <b style={{float:"right"}}>256 MB</b></p>
            <hr />
            <p>STORAGE <b style={{float:"right"}}>1.2 GB</b></p>
          </div>

          <button style={{
            width:"100%",
            padding:"12px",
            marginTop:"20px",
            borderRadius:"10px",
            background:"#ffffff10",
            color:"white",
            border:"1px solid #ffffff20"
          }}>
            Manage Server →
          </button>
        </div>
      </section>

      <div style={{
        textAlign:"center",
        fontSize:"55px",
        marginTop:"-30px"
      }}>
      </div>

      <section style={{
        padding:"80px 5%",
        textAlign:"center"
      }}>
        <p style={{color:"#9be7ad"}}>BUILT FOR CREATORS</p>
        <h2 style={{fontSize:"42px"}}>Everything your bots need.</h2>

        <div style={{
          display:"grid",
          gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",
          gap:"15px",
          marginTop:"40px"
        }}>
          {[
            ["⚡","Instant Deploy"],
            ["🖥️","Powerful Servers"],
            ["🛡️","Always Protected"],
            ["📊","Live Monitoring"]
          ].map(([emoji,title]) => (
            <div key={title} style={{
              padding:"25px",
              borderRadius:"15px",
              background:"#ffffff08",
              border:"1px solid #ffffff12"
            }}>
              <div style={{fontSize:"30px"}}>{emoji}</div>
              <h3>{title}</h3>
              <p style={{color:"#82968c"}}>
                Powerful infrastructure for your bots.
              </p>
            </div>
          ))}
        </div>
      </section>

      <footer style={{
        padding:"30px 5%",
        borderTop:"1px solid #ffffff15",
        color:"#789486"
      }}>
        <b>ASTRIX HOSTING</b>
        <span style={{float:"right"}}>© 2026 Astrix Hosting</span>
      </footer>

      {showHosting && (
        <div style={{
          position:"fixed",
          inset:0,
          background:"rgba(0,0,0,0.72)",
          display:"flex",
          alignItems:"center",
          justifyContent:"center",
          padding:"20px",
          zIndex:1000
        }}>
          <div style={{
            width:"100%",
            maxWidth:"430px",
            background:"#101820",
            border:"1px solid rgba(255,255,255,0.15)",
            borderRadius:"20px",
            padding:"28px",
            textAlign:"center",
            boxShadow:"0 20px 80px rgba(0,0,0,0.5)"
          }}>
            <h2 style={{fontSize:"28px", marginBottom:"10px"}}>
              Free Hosting
            </h2>

            <p style={{
              color:"#b8c3cc",
              lineHeight:1.6,
              marginBottom:"22px"
            }}>
              Join the Astrix Hosting Discord server and use
              <b style={{color:"#fff"}}> zy!server create</b>
              to start your free hosting deployment.
            </p>

            <a
              href="https://discord.gg/3B5PF9SC8j"
              target="_blank"
              rel="noreferrer"
              style={{
                display:"block",
                padding:"13px",
                borderRadius:"12px",
                background:"#5865F2",
                color:"#fff",
                textDecoration:"none",
                fontWeight:"bold",
                marginBottom:"12px"
              }}
            >
              Join Discord
            </a>

            <button
              onClick={() => setShowHosting(false)}
              style={{
                width:"100%",
                padding:"13px",
                borderRadius:"12px",
                border:"1px solid rgba(255,255,255,0.18)",
                background:"#18232d",
                color:"#fff",
                fontWeight:"bold",
                cursor:"pointer"
              }}
            >
              I've Joined — Continue
            </button>

            <button
              onClick={() => setShowHosting(false)}
              style={{
                marginTop:"14px",
                background:"transparent",
                border:0,
                color:"#8f9aa5",
                cursor:"pointer"
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

    </main>
  );
}