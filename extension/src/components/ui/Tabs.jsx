/**
 * Tabs component for filtering/navigation
 *
 * @param {Object} props
 * @param {Array<{id: string, label: string, count?: number}>} props.tabs - Tab items
 * @param {string} props.activeTab - Currently active tab ID
 * @param {Function} props.onChange - Tab change handler
 * @param {string} props.className - Additional CSS classes
 */
export function Tabs({ tabs, activeTab, onChange, className = '' }) {
  return (
    <div class={`hypatia-tabs ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          class={`hypatia-tab ${activeTab === tab.id ? 'hypatia-tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span class="hypatia-tab__count">{tab.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/**
 * Pill tabs variant (horizontal, no underline)
 */
export function PillTabs({ tabs, activeTab, onChange, className = '' }) {
  return (
    <div class={`hypatia-pill-tabs ${className}`}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          class={`hypatia-pill-tab ${activeTab === tab.id ? 'hypatia-pill-tab--active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span class="hypatia-pill-tab__count">({tab.count})</span>
          )}
        </button>
      ))}
    </div>
  );
}
