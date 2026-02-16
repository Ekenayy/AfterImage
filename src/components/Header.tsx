"use client";

import { useState, useRef, useEffect } from "react";

const EXAMPLE_QUESTIONS = [
  "Who signed the discharge for the patient from the post-anaesthesia care unit on April 6?",
  "How do we know the patient has problems sleeping?",
  "What medications is the patient taking related to anxiety or sleep?",
];

interface HeaderProps {
  onSelectExample: (question: string) => void;
  onClearHighlights: () => void;
}

export default function Header({
  onSelectExample,
  onClearHighlights,
}: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3">
      <h1 className="text-lg font-semibold text-gray-900">AfterImage</h1>

      <div className="flex items-center gap-3">
        {/* Examples dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
          >
            Examples
            <svg
              className="ml-1 -mr-0.5 inline h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>

          {dropdownOpen && (
            <div className="absolute right-0 z-10 mt-1 w-96 rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => {
                    onSelectExample(q);
                    setDropdownOpen(false);
                  }}
                  className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Clear highlights */}
        <button
          type="button"
          onClick={onClearHighlights}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 transition-colors hover:bg-gray-50"
        >
          Clear Highlights
        </button>
      </div>
    </header>
  );
}
