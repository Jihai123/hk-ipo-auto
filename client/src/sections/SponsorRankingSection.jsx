import RankingCard from '../components/RankingCard';

export default function SponsorRankingSection() {
  const sponsors = [
    {
      rank: 1,
      sponsor: 'Goldman Sachs (Asia)',
      ipoCount: 28,
      positiveRate: 82,
      avgReturn: '+24.5%',
      bestProject: '+156% (09988)',
      worstProject: '-8% (02345)',
    },
    {
      rank: 2,
      sponsor: 'Morgan Stanley Asia',
      ipoCount: 24,
      positiveRate: 79,
      avgReturn: '+21.3%',
      bestProject: '+142% (01234)',
      worstProject: '-12% (05678)',
    },
    {
      rank: 3,
      sponsor: 'CICC (China International)',
      ipoCount: 32,
      positiveRate: 75,
      avgReturn: '+18.7%',
      bestProject: '+98% (08899)',
      worstProject: '-15% (06789)',
    },
    {
      rank: 4,
      sponsor: 'UBS AG Hong Kong',
      ipoCount: 19,
      positiveRate: 74,
      avgReturn: '+17.2%',
      bestProject: '+88% (03456)',
      worstProject: '-9% (07890)',
    },
    {
      rank: 5,
      sponsor: 'Credit Suisse (HK)',
      ipoCount: 21,
      positiveRate: 71,
      avgReturn: '+16.8%',
      bestProject: '+92% (04567)',
      worstProject: '-11% (08901)',
    },
  ];

  return (
    <section className="py-16 bg-gray-50">
      <div className="container mx-auto px-6 max-w-7xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Sponsor Performance Ranking</h2>
            <p className="text-gray-600">Based on 2-year IPO track record and first-day performance</p>
          </div>
          <button className="text-accent-start hover:text-accent-end font-semibold flex items-center gap-2">
            View All Sponsors
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        <div className="space-y-4">
          {sponsors.map((sponsor) => (
            <RankingCard key={sponsor.rank} {...sponsor} />
          ))}
        </div>

        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-start gap-3">
            <div className="text-2xl">💡</div>
            <div>
              <h4 className="font-bold text-gray-900 mb-2">About Sponsor Performance</h4>
              <p className="text-sm text-gray-700">
                Sponsor reputation significantly impacts IPO success rates. Our data shows that top-tier sponsors have 15-20% higher first-day positive rates compared to lower-ranked sponsors. This metric is a key factor in our quantitative model.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
