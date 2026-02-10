import IPOListItem from '../components/IPOListItem';
import DataPanel from '../components/DataPanel';
import ScoreBadge from '../components/ScoreBadge';

export default function IPOPipelineSection() {
  const subscribingNow = [
    {
      code: '09988',
      name: 'Tech Innovation Limited',
      status: 'Subscribing Now',
      date: 'Feb 15, 2026',
      entryFee: 'HK$ 10,212',
      priceRange: '$18.5-21.0',
      countdown: '2d 14h',
    },
    {
      code: '02768',
      name: 'Green Energy Holdings',
      status: 'Subscribing Now',
      date: 'Feb 12, 2026',
      entryFee: 'HK$ 8,540',
      priceRange: '$12.0-15.5',
      countdown: '18h',
    },
  ];

  const listingSoon = [
    {
      code: '01234',
      name: 'FinTech Solutions Co',
      status: 'Listing Soon',
      date: 'Feb 20, 2026',
      entryFee: 'HK$ 12,450',
      priceRange: '$22.0-26.0',
    },
  ];

  const filed = [
    {
      code: '05678',
      name: 'Healthcare Innovations',
      status: 'Filed',
      date: 'TBD',
      entryFee: 'TBD',
      priceRange: 'TBD',
    },
  ];

  return (
    <section className="py-16 bg-white">
      <div className="container mx-auto px-6 max-w-7xl">
        <h2 className="text-3xl font-bold text-gray-900 mb-8">IPO Pipeline</h2>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left: IPO Calendar List */}
          <div className="lg:col-span-2 space-y-6">
            {/* Subscribing Now */}
            <div>
              <div className="flex items-center gap-3 mb-4">
                <h3 className="text-xl font-bold text-gray-900">Subscribing Now</h3>
                <span className="px-3 py-1 bg-green-100 text-green-700 text-sm font-semibold rounded-full">
                  {subscribingNow.length} Active
                </span>
              </div>
              <div className="space-y-3">
                {subscribingNow.map((ipo) => (
                  <IPOListItem key={ipo.code} {...ipo} isActive={true} />
                ))}
              </div>
            </div>

            {/* Listing Soon */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">Listing Soon</h3>
              <div className="space-y-3">
                {listingSoon.map((ipo) => (
                  <IPOListItem key={ipo.code} {...ipo} />
                ))}
              </div>
            </div>

            {/* Filed, Awaiting Pricing */}
            <div>
              <h3 className="text-xl font-bold text-gray-900 mb-4">Filed, Awaiting Pricing</h3>
              <div className="space-y-3">
                {filed.map((ipo) => (
                  <IPOListItem key={ipo.code} {...ipo} />
                ))}
              </div>
            </div>
          </div>

          {/* Right: Quick IPO Info Panel */}
          <div>
            <DataPanel title="Featured: 09988">
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-gray-500 mb-1">Price Range</div>
                  <div className="text-2xl font-bold text-gray-900">HK$ 18.5 - 21.0</div>
                </div>

                <div>
                  <div className="text-sm text-gray-500 mb-1">Subscription Deadline</div>
                  <div className="text-lg font-semibold text-gray-900">Feb 15, 2026 12:00 PM</div>
                  <div className="text-sm text-accent-start font-medium mt-1">
                    ⏰ Ends in 2d 14h
                  </div>
                </div>

                <div>
                  <div className="text-sm text-gray-500 mb-1">Fundraising Size</div>
                  <div className="text-lg font-semibold text-gray-900">HK$ 2.8B</div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                  <div className="text-sm text-gray-500 mb-3">Model Score</div>
                  <div className="flex justify-center">
                    <ScoreBadge score={78} size="lg" />
                  </div>
                </div>

                <button className="w-full gradient-accent text-white py-3 rounded-lg font-semibold hover:opacity-90 transition-opacity">
                  View Full Analysis
                </button>
              </div>
            </DataPanel>
          </div>
        </div>
      </div>
    </section>
  );
}
