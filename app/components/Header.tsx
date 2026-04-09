'use client';

interface HeaderProps {
  onToggleFilters?: () => void;
  showFilterButton?: boolean;
}

export default function Header({ onToggleFilters, showFilterButton }: HeaderProps) {
  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
      <span className="text-xl font-bold text-gray-900">AptByBART</span>

      <div className="flex items-center gap-2">
        {showFilterButton && (
          <button
            onClick={onToggleFilters}
            className="lg:hidden px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Filters
          </button>
        )}
      </div>
    </header>
  );
}
