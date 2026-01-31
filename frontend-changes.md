# Frontend Redesign Changes

## Overview

Migrated the Hypatia extension frontend from vanilla JS string templating to a modern Preact-based component architecture with Gmail-native design, auto dark mode detection, and improved UX.

---

## New Technology Stack

| Before | After |
|--------|-------|
| Vanilla JS with string templates | Preact (3KB React-compatible) |
| Inline styles + CSS | CSS Variables design system |
| Global state variables | Preact Signals for reactivity |
| No dark mode | Auto-detects Gmail's theme |

---

## New File Structure

```
extension/
├── package.json                    # New - npm dependencies
├── esbuild.config.js               # New - build configuration
├── src/
│   ├── index.jsx                   # Entry point
│   ├── components/
│   │   ├── core/
│   │   │   ├── App.jsx             # Root component
│   │   │   ├── Panel.jsx           # Gmail content panel
│   │   │   └── Router.jsx          # Hash-based routing
│   │   ├── ui/                     # Reusable components
│   │   │   ├── Button.jsx
│   │   │   ├── Card.jsx
│   │   │   ├── Badge.jsx
│   │   │   ├── Input.jsx
│   │   │   ├── Modal.jsx
│   │   │   ├── Spinner.jsx
│   │   │   ├── Avatar.jsx
│   │   │   ├── EmptyState.jsx
│   │   │   ├── Tabs.jsx
│   │   │   └── index.js
│   │   └── screens/
│   │       ├── CampaignsList.jsx
│   │       ├── CampaignDetail.jsx
│   │       ├── LeadsScreen.jsx
│   │       ├── TemplateEditor.jsx
│   │       ├── SentEmails.jsx
│   │       └── GeneratingScreen.jsx
│   ├── hooks/
│   │   ├── useGmailTheme.js        # Auto dark mode detection
│   │   └── useNavigation.js        # Hash-based routing
│   ├── context/
│   │   └── AppContext.jsx          # Global state management
│   └── styles/
│       ├── tokens.css              # Design tokens (colors, spacing, etc.)
│       ├── components.css          # UI component styles
│       └── screens.css             # Screen-specific styles
└── dist/
    ├── content.bundle.js           # Built JS (~64KB minified)
    └── content.bundle.css          # Built CSS (~31KB)
```

---

## Design System

### CSS Variables (tokens.css)

**Light Theme:**
- `--hypatia-bg-primary: #ffffff`
- `--hypatia-bg-secondary: #f8f9fa`
- `--hypatia-text-primary: #202124`
- `--hypatia-text-secondary: #5f6368`
- `--hypatia-accent-primary: #1a73e8`

**Dark Theme** (auto-applied via `[data-hypatia-theme="dark"]`):
- `--hypatia-bg-primary: #1f1f1f`
- `--hypatia-bg-secondary: #2d2d2d`
- `--hypatia-text-primary: #e8eaed`
- `--hypatia-accent-primary: #8ab4f8`

**Spacing Scale:** 4px, 8px, 12px, 16px, 24px, 32px, 40px

**Border Radius:** 4px, 8px, 12px, 16px

---

## Gmail Integration

The Preact UI injects into Gmail's content area (`.nH.bkK`), not as a full-screen overlay:

```javascript
// src/index.jsx
function getGmailContentArea() {
  return document.querySelector('.nH.bkK') || document.querySelector('.nH.nn') || document.body;
}
```

**Positioning:**
- Uses `position: absolute` within Gmail's content area
- Parent element gets `position: relative`
- Gmail header, sidebar, and tabs remain accessible

---

## Dark Mode Detection

The `useGmailTheme` hook automatically detects Gmail's theme:

```javascript
// Detects via background color luminance
const luminance = (r * 299 + g * 587 + b * 114) / 1000;
const isDark = luminance < 128;
```

- Watches for theme changes via MutationObserver
- Applies `data-hypatia-theme="dark"` attribute automatically

---

## State Management

Uses Preact Signals for reactive state:

```javascript
// context/AppContext.jsx
export const campaigns = signal([]);
export const selectedCampaign = computed(() => ...);
export const currentLeads = signal([]);
export const generationState = signal({ ... });
```

**Actions pattern:**
```javascript
actions.setCampaigns(data);
actions.selectCampaign(id);
actions.toggleLeadSelection(leadId);
```

---

## UI Components

| Component | Purpose |
|-----------|---------|
| `Button` | Primary, secondary, ghost, danger variants |
| `Card` | Interactive cards with hover states |
| `Badge` | Status indicators (success, warning, error) |
| `Input` / `Textarea` | Form inputs with labels and errors |
| `Modal` | Dialog with backdrop and focus trap |
| `Avatar` | Initials-based with consistent colors |
| `Spinner` | Loading indicators |
| `Tabs` | Filter/navigation tabs |
| `EmptyState` | No-data states with CTAs |

---

## Screen Components

### CampaignsList
- Responsive grid: `repeat(auto-fill, minmax(320px, 1fr))`
- Search/filter functionality
- Pagination controls
- Campaign cards with status badges

### CampaignDetail
- Stats cards (emails, leads, sent, similarity)
- Campaign analysis section (style, CTA, targets)
- Action cards grid (Generate Leads, Template, Send, Track)

### LeadsScreen
- AI lead search with suggestions
- Manual lead entry form
- Lead list with bulk selection
- LinkedIn links and status badges

### TemplateEditor
- Two-column: editor + live preview
- Variable insertion chips
- Real-time preview with lead data
- Lead navigation for preview

### SentEmails
- Stats cards (total, delivered, opened, replied, bounced)
- Filter tabs by status
- Email cards with status icons

### GeneratingScreen
- Three-column parallel progress
- Individual section states (loading, success, error)
- Retry functionality

---

## Build Commands

```bash
# Install dependencies
cd extension && npm install

# Build for production
npm run build

# Watch mode for development
npm run watch
```

---

## Manifest Changes

Added to `manifest.json`:

```json
{
  "content_scripts": [{
    "js": [..., "dist/content.bundle.js"],
    "css": ["styles.css", "dist/content.bundle.css"]
  }],
  "web_accessible_resources": [{
    "resources": ["icons/*"],
    "matches": ["https://mail.google.com/*"]
  }]
}
```

---

## Coexistence with Existing Code

The new Preact code runs alongside the existing vanilla JS:
- Both systems use hash-based routing (`#hypatia`, `#hypatia/campaign/{id}`, etc.)
- The existing `content.js` handles the "H" button and initial panel creation
- Preact components provide the new UI within that panel
- Gradual migration: screens can be migrated one at a time

---

## Testing

1. Run `npm run build` in the extension folder
2. Load unpacked extension at `chrome://extensions`
3. Navigate to Gmail
4. Click the "H" button or go to `#hypatia`
5. Test both light and dark Gmail themes
