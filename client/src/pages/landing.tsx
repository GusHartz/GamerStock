import { Activity, Shield, Zap } from "lucide-react";
import logoImg from "@assets/ChatGPT_Image_3_de_mar._de_2026__11_48_14-removebg-preview_1773185791880.png";
import { motion } from "framer-motion";

export default function LandingPage() {
  const handleLogin = () => {
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen bg-[#0A0E17] flex flex-col md:flex-row font-sans overflow-hidden">
      {/* Left Panel - Branding & Visuals */}
      <div className="relative w-full md:w-1/2 min-h-[50vh] md:min-h-screen flex flex-col justify-between p-8 lg:p-16 border-b md:border-b-0 md:border-r border-white/10 overflow-hidden">
        {/* Abstract background graphics */}
        <div className="absolute top-[-10%] left-[-10%] w-[120%] h-[120%] bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-[#0A0E17]/80 to-[#0A0E17] -z-10 blur-3xl"></div>
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-primary/20 rounded-full mix-blend-screen filter blur-[100px] opacity-50 animate-pulse"></div>

        <div className="relative z-10">
          <div className="flex items-center mb-16">
            <img src={logoImg} alt="GamerStock" className="h-10 w-auto object-contain" />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-display font-bold text-white leading-[1.1] mb-6">
              The First Market for <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-emerald-300">
                Esports Performance
              </span>
            </h1>
            <p className="text-lg text-muted-foreground max-w-md leading-relaxed">
              Trade shares of top League of Legends players based on their live performance. Build your ultimate portfolio and realize your gains.
            </p>
          </motion.div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mt-16 relative z-10">
          <div className="glass-panel p-5 rounded-2xl">
            <Activity className="w-6 h-6 text-primary mb-3" />
            <h3 className="font-semibold text-white mb-1">Live Valuations</h3>
            <p className="text-sm text-muted-foreground">Prices driven purely by market demand and real-time performance algorithms.</p>
          </div>
          <div className="glass-panel p-5 rounded-2xl">
            <Zap className="w-6 h-6 text-emerald-400 mb-3" />
            <h3 className="font-semibold text-white mb-1">Instant Execution</h3>
            <p className="text-sm text-muted-foreground">Trade instantly with deep liquidity and dynamic pricing curves.</p>
          </div>
        </div>
      </div>

      {/* Right Panel - Auth */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8 bg-[#0A0E17] relative">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.02]"></div>
        
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="w-full max-w-md glass-panel p-10 rounded-3xl relative z-10 shadow-2xl shadow-black"
        >
          <div className="text-center mb-10">
            <h2 className="text-3xl font-display font-bold text-white mb-3">Welcome to the Terminal</h2>
            <p className="text-muted-foreground">Sign in to access your playUSDC balance and start trading.</p>
          </div>

          <button
            onClick={handleLogin}
            className="w-full py-4 px-6 rounded-xl font-bold text-lg bg-white text-black hover:bg-gray-100 hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 flex items-center justify-center gap-3 shadow-xl"
          >
            <Shield className="w-5 h-5" />
            Enter Market
          </button>
          
          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
              System Status: Operational
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
