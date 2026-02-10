import HeroSection from './sections/HeroSection';
import MarketStatsBar from './sections/MarketStatsBar';
import IPOPipelineSection from './sections/IPOPipelineSection';
import FeaturedIPOSection from './sections/FeaturedIPOSection';
import PerformanceBoardSection from './sections/PerformanceBoardSection';
import SponsorRankingSection from './sections/SponsorRankingSection';
import ModelStructureSection from './sections/ModelStructureSection';
import MethodologySection from './sections/MethodologySection';
import FinalCTASection from './sections/FinalCTASection';

function App() {
  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm backdrop-blur-sm bg-white/95">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-8">
              <div className="font-bold text-2xl gradient-accent bg-clip-text text-transparent">
                HK IPO Terminal
              </div>
              <div className="hidden md:flex items-center gap-6">
                <a href="#market" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  Market Data
                </a>
                <a href="#pipeline" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  IPO Pipeline
                </a>
                <a href="#sponsors" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  Sponsors
                </a>
                <a href="#model" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  Model
                </a>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <button className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                Sign In
              </button>
              <button className="gradient-accent text-white px-6 py-2 rounded-lg font-semibold hover:opacity-90 transition-opacity">
                Get Started
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main>
        <HeroSection />
        <MarketStatsBar />
        <IPOPipelineSection />
        <FeaturedIPOSection />
        <PerformanceBoardSection />
        <SponsorRankingSection />
        <ModelStructureSection />
        <MethodologySection />
        <FinalCTASection />
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="font-bold text-xl mb-4 gradient-accent bg-clip-text text-transparent">
                HK IPO Terminal
              </div>
              <p className="text-gray-400 text-sm">
                Professional quantitative analysis platform for Hong Kong IPO investments
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Product</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">IPO Screener</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Market Dashboard</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API Access</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Pricing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Resources</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Documentation</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Model Methodology</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Data Sources</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Blog</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">Company</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About Us</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
            <p>© 2026 HK IPO Terminal. All rights reserved. Not investment advice.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
