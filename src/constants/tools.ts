// ─── Tool Definitions ────────���──────────────────────────────────────
// Extracted from App.tsx

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'update_working_memory',
      description: 'Update your short-term memory to avoid losing context. Call this when you complete a step or change goals.',
      parameters: {
        type: 'object',
        properties: {
          current_goal: { type: 'string' },
          done_steps: { type: 'string' },
          open_tasks: { type: 'string' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_command',
      description: 'Execute a PowerShell command on the Windows system',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to execute' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to read' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to write' },
          content: { type: 'string', description: 'The content to write' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'List files and folders in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_file_or_url',
      description: 'Open a file or URL with the default application',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'File path or URL to open' }
        },
        required: ['target']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'plan_tasks',
      description: 'Create a task plan to decompose a complex request into subtasks. Use this for multi-step goals.',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: 'The overall goal' },
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                status: { type: 'string', description: 'pending | in_progress | done | failed' }
              }
            },
            description: 'List of subtasks'
          }
        },
        required: ['goal', 'tasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'update_task_status',
      description: 'Update the status of a subtask in the current plan.',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string' },
          status: { type: 'string', description: 'pending | in_progress | done | failed' },
          result: { type: 'string', description: 'Optional result or note' }
        },
        required: ['task_id', 'status']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Navigate to a URL in the built-in browser. Returns page title, final URL, and extracted text content. The browser uses Electron\'s native Chromium — no external dependencies needed. Handles SPAs and JavaScript-rendered pages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to navigate to (https:// prefix added if missing)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_text',
      description: 'Get the text content of the current browser page. Optionally extract from a specific CSS selector. Smart extraction: tries <article> or <main> first, falls back to <body>.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'Optional CSS selector to extract text from (e.g. "article", ".content", "#main")' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_click',
      description: 'Click an element on the page by CSS selector. Auto-scrolls the element into view before clicking.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the element to click (e.g. "button.submit", "#login-btn", "a[href=\'/about\']")' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type',
      description: 'Type text into an input field by CSS selector. Triggers input and change events. Optionally press Enter after typing.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector of the input (e.g. "#search", "input[name=q]")' },
          text: { type: 'string', description: 'Text to type' },
          pressEnter: { type: 'boolean', description: 'If true, press Enter after typing (useful for search forms)' }
        },
        required: ['selector', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait',
      description: 'Wait for a CSS selector to appear on the page. Uses MutationObserver for efficient DOM watching. Returns when element is found or timeout expires.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector to wait for' },
          timeout: { type: 'number', description: 'Max wait time in ms (default 5000, max 10000)' }
        },
        required: ['selector']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_links',
      description: 'Extract all links (href + text) from the current page. Returns up to 100 links. Useful for mapping a site structure or finding specific pages.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_forms',
      description: 'Discover all form inputs, textareas, selects, and submit buttons on the page. Returns tag, type, name, placeholder, and CSS selector for each. Use this before browser_type to find the correct selectors.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_screenshot',
      description: 'Capture a screenshot of the current browser page. Returns base64-encoded PNG with viewport dimensions. Use this to see what the page looks like before deciding what to click. The screenshot shows the page exactly as the user sees it in the browser window.',
      parameters: { type: 'object', properties: {} }
    }
  },
  // ─── Computer Use Tools (vision-based, like Claude/Manus) ──────
  {
    type: 'function',
    function: {
      name: 'browser_click_at',
      description: 'Click at specific pixel coordinates (x, y) in the browser viewport. Use after taking a screenshot and identifying where to click. Coordinates are relative to the top-left of the page viewport.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate (pixels from left edge)' },
          y: { type: 'number', description: 'Y coordinate (pixels from top edge)' }
        },
        required: ['x', 'y']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_type_text',
      description: 'Type text at the current cursor position in the browser. Use after clicking on an input field with browser_click_at. Types character by character like a real user.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to type' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_key_press',
      description: 'Press a keyboard key in the browser. Use for Enter, Tab, Escape, Backspace, arrow keys, etc.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key to press: Enter, Tab, Escape, Backspace, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight' }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll',
      description: 'Scroll the browser page. Negative deltaY scrolls down (most common), positive scrolls up.',
      parameters: {
        type: 'object',
        properties: {
          deltaY: { type: 'number', description: 'Scroll amount in pixels. -300 = scroll down one "page", 300 = scroll up. Default: -300' },
          x: { type: 'number', description: 'Optional X position to scroll at (default: center)' },
          y: { type: 'number', description: 'Optional Y position to scroll at (default: center)' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_command',
      description: 'Run a git command in a specified directory. Supports: status, diff, log, add, commit, branch, checkout, stash. Use for version control awareness.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The git subcommand and args (e.g. "status", "diff --stat", "log --oneline -10", "add .", "commit -m msg")' },
          cwd: { type: 'string', description: 'Working directory (the repo path)' }
        },
        required: ['command', 'cwd']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'undo_last_write',
      description: 'Undo the last file write operation, restoring the file to its previous state. Use when a write produced errors or bad results.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delegate_subtasks',
      description: 'Run multiple subtasks in parallel using collaborative agents. Each subtask gets its own AI instance.',
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string', description: 'The instruction for this agent' }
              }
            },
            description: 'List of subtasks to execute in parallel'
          }
        },
        required: ['subtasks']
      }
    }
  }
]

// Safety limits
export const AGENT_SAFETY_LIMIT = 200
export const NORMAL_SAFETY_LIMIT = 50
export const IDLE_STEP_THRESHOLD = 5

// Permission sets
export const SAFE_TOOLS = new Set([
  'read_file', 'list_directory', 'web_search', 'browser_get_text',
  'browser_get_links', 'browser_get_forms', 'browser_screenshot', 'browser_wait',
  'update_working_memory', 'plan_tasks', 'update_task_status', 'undo_last_write'
])

export const DANGEROUS_TOOLS = new Set([
  'execute_command', 'write_file', 'open_file_or_url', 'git_command',
  'browser_navigate', 'browser_click', 'browser_type', 'delegate_subtasks',
  // Computer Use — vision-based coordinate interaction
  'browser_click_at', 'browser_type_text', 'browser_key_press', 'browser_scroll',
])
