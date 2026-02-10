export default function DataPanel({ title, children, className = '' }) {
  return (
    <div className={`bg-white rounded-card p-6 shadow-card ${className}`}>
      {title && (
        <h3 className="text-lg font-bold text-gray-900 mb-4 pb-3 border-b border-gray-100">
          {title}
        </h3>
      )}
      <div>{children}</div>
    </div>
  );
}
