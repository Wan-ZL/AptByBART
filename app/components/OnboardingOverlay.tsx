'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'aptbybart-onboarding-dismissed';

export default function OnboardingOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined' && !localStorage.getItem(STORAGE_KEY)) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl max-w-md mx-4 p-6">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Welcome to AptByBART</h2>
        <p className="text-sm text-gray-600 mb-4">
          Find affordable, safe apartments near BART stations in the Bay Area.
        </p>
        <ul className="text-sm text-gray-600 space-y-2 mb-5">
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">●</span>
            <span><strong>Colored lines</strong> = BART routes. Click a station to see commute time and fare to Montgomery St.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">●</span>
            <span><strong>Blue dots</strong> = apartments. Click one to see floor plans, prices, and safety info.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">●</span>
            <span>Use the <strong>filters</strong> on the left to narrow by price, bedrooms, amenities, and more.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-blue-500 mt-0.5">●</span>
            <span>Toggle the <strong>Safety overlay</strong> to see crime data around each station.</span>
          </li>
        </ul>
        <button
          onClick={dismiss}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Start Exploring
        </button>
      </div>
    </div>
  );
}
