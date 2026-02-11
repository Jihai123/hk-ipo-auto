// 新的专业金融工具型组件
import NewHeroSection from './sections/NewHeroSection';
import MarketSnapshotSection from './sections/MarketSnapshotSection';
import ScoreBreakdownSection from './sections/ScoreBreakdownSection';
import ModelPerformanceSection from './sections/ModelPerformanceSection';
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
                港股打新量化评分
              </div>
              <div className="hidden md:flex items-center gap-6">
                <a href="#score" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  快速评分
                </a>
                <a href="#market" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  市场环境
                </a>
                <a href="#performance" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  历史表现
                </a>
                <a href="#model" className="text-gray-700 hover:text-accent-start font-medium transition-colors">
                  评分模型
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
        {/* ① Hero区：产品定位 + 双入口（快速评分 + Top榜单） */}
        <NewHeroSection />

        {/* ② 当前打新市场环境快照 */}
        <MarketSnapshotSection />

        {/* ③ 单只新股评分拆解示例（建立信任） */}
        <ScoreBreakdownSection />

        {/* ④ 模型历史表现验证（专业背书） */}
        <ModelPerformanceSection />

        {/* ⑤ 评分规则说明区（降级为支撑模块） */}
        <ModelStructureSection />

        {/* ⑥ 方法论与信任信号 */}
        <MethodologySection />

        {/* ⑦ 最终行动号召 */}
        <FinalCTASection />
      </main>

      {/* Footer */}
      <footer className="bg-gray-900 text-white py-12">
        <div className="container mx-auto px-6 max-w-7xl">
          <div className="grid md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="font-bold text-xl mb-4 gradient-accent bg-clip-text text-transparent">
                港股打新量化评分系统
              </div>
              <p className="text-gray-400 text-sm">
                基于基本面、基石结构、行业热度与市场环境的综合打新决策评分平台
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">产品功能</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">新股评分</a></li>
                <li><a href="#" className="hover:text-white transition-colors">市场仪表盘</a></li>
                <li><a href="#" className="hover:text-white transition-colors">历史数据</a></li>
                <li><a href="#" className="hover:text-white transition-colors">API接口</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">学习资源</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">使用文档</a></li>
                <li><a href="#" className="hover:text-white transition-colors">评分方法论</a></li>
                <li><a href="#" className="hover:text-white transition-colors">数据来源</a></li>
                <li><a href="#" className="hover:text-white transition-colors">打新知识</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">关于我们</h4>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">团队介绍</a></li>
                <li><a href="#" className="hover:text-white transition-colors">联系方式</a></li>
                <li><a href="#" className="hover:text-white transition-colors">隐私政策</a></li>
                <li><a href="#" className="hover:text-white transition-colors">服务条款</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-center text-sm text-gray-400">
            <p>© 2026 港股打新量化评分系统. 保留所有权利. 本系统仅供参考，不构成投资建议。</p>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
