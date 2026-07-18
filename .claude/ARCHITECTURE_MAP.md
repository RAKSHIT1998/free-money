# Architecture Map

## Project Structure
```
/ (root)
├── .claude/                   # Claude Code instructions and utilities
│   ├── COMMON_MISTAKES.md
│   ├── QUICK_START.md
│   └── ARCHITECTURE_MAP.md
├── src/                       # Source code
│   ├── components/            # React components (if frontend)
│   │   ├── ui/                # Reusable UI components
│   │   └── pages/             # Page components
│   ├── services/              # API services, API clients
│   ├── utils/                 # Utility functions, helpers
│   ├── hooks/                 # Custom React hooks
│   ├── contexts/              # React context providers
│   ├── assets/                # Static assets (images, icons)
│   ├── styles/                # CSS, SCSS, styled-components
│   ├── constants/             # Constant values
│   └── index.js               # Entry point
├── server/                    # Backend Node.js code (if applicable)
│   ├── controllers/
│   ├── models/
│   ├── routes/
│   ├── middleware/
│   ├── utils/
│   └── server.js
├── database/                  # Database scripts, migrations
│   ├── migrations/
│   └── seeds/
├── tests/                     # Test files
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/                      # Documentation
│   ├── api/
│   └── architecture/
├── scripts/                   # Utility scripts
├── config/                    # Configuration files
├── .gitignore
├── package.json
├── README.md
└── .env.example
```

## Technology Stack
- **Frontend**: React (or Vue/Angular as per project)
- **Backend**: Node.js with Express
- **Database**: MongoDB
- **DevTools**: VS Code, Docker
- **State Management**: Redux or Context API
- **Styling**: CSS Modules or Styled Components
- **Testing**: Jest, React Testing Library, Cypress