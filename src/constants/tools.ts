// ─── Tool Definitions ────────���──────────────────────────────────────
// Extracted from App.tsx

import { subagentRolesHint } from './subagents'

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
      description: 'Execute a PowerShell command on the Windows system. Output includes stderr and the exit code on failure. Default timeout is 60s — pass timeout_s for long-running commands (builds, installs, backtests).',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to execute' },
          cwd: { type: 'string', description: 'Optional absolute path of the working directory to run in. Defaults to the active project folder when one is set.' },
          timeout_s: { type: 'number', description: 'Optional timeout in seconds (default 60, max 600). Use a higher value when the command is expected to take long, e.g. builds or installs.' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_command_background',
      // Paridade com Bash run_in_background do Claude Code (v2.83.0).
      description: 'Start a PowerShell command in the BACKGROUND and return immediately with a handle, instead of waiting for it like execute_command. Use for long-running processes you want to keep working alongside: dev servers, watchers, long backtests/builds. Poll its output with get_command_output and stop it with kill_background_command. For a normal command whose result you need now, use execute_command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The PowerShell command to run in the background' },
          cwd: { type: 'string', description: 'Optional working directory. Defaults to the active project folder.' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_command_output',
      description: 'Get the NEW output (since your last check) and status of a background command started with run_command_background. Returns incremental stdout/stderr, whether it is still running, and the exit code once it finishes. Poll this periodically while doing other work.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The background command id (e.g. "bg1")' } },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kill_background_command',
      description: 'Stop a background command (started with run_command_background) and its whole process tree. Use when you no longer need a server/watcher running, or to stop a runaway process.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The background command id to kill' } },
        required: ['id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file. For LARGE files, pass offset + limit to read a specific line range (the result tells you the total line count and how to continue) instead of getting a blindly-truncated middle.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to read' },
          offset: { type: 'number', description: 'Optional 1-based start line to read from' },
          limit: { type: 'number', description: 'Optional number of lines to read from offset' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file (replaces the ENTIRE file). For changing part of an existing file, prefer edit_file.',
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
      name: 'remember_fact',
      description: 'Save a durable note to PERSISTENT memory (survives across ALL future conversations). Use for stable, reusable knowledge: file paths, build commands, the user\'s preferences, project details. Do NOT use for ephemeral task state — use update_working_memory for that. For TIME-SENSITIVE facts you just verified on the web (versions, prices, releases), use remember_fresh_fact instead.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['fact', 'preference', 'project'], description: 'Which bucket to store it in (default: fact)' },
          content: { type: 'string', description: 'The note to remember, concise and self-contained' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'remember_fresh_fact',
      description: 'Cache a TIME-SENSITIVE fact you JUST verified on the web, so future turns can reuse it without searching again. Use right after web_search/fetch_url for things like "latest version of X is Y", current prices, recent releases. Include the source URL. The fact carries a freshness TTL and is shown back later as "recently verified" while fresh, or "possibly outdated, re-verify" once the TTL passes. Do NOT use for timeless facts — use remember_fact for those.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The verified fact, concise and self-contained (e.g. "Latest stable React is 20.2, released May 2026")' },
          source: { type: 'string', description: 'URL or origin where it was verified' },
          ttl_days: { type: 'number', description: 'Optional freshness window in days. If omitted, inferred from content (prices/news ~1d, versions/APIs ~30d, else 14d).' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search file CONTENTS for a text snippet across a directory (like grep). Use this to find where something is defined or mentioned — far faster and more reliable than Select-String via execute_command or reading files one by one. Returns matches as path:line: text.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The literal text to search for (case-insensitive by default)' },
          path: { type: 'string', description: 'Directory to search in (absolute). Defaults to the working directory.' },
          glob: { type: 'string', description: 'Optional filename filter by extension, e.g. "*.ts" or "ts,tsx"' },
          max_results: { type: 'number', description: 'Optional cap on matches (default 100, max 500)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'load_skill',
      description: 'Load the full instructions of one or more available skills (listed in [SKILLS DISPONÍVEIS]) when relevant to the task. Returns the skill\'s detailed playbook to follow — and the skill stays ACTIVE for the rest of the task (re-reinforced each step). The name is matched leniently (case/space/hyphen-insensitive), and on a miss the closest skill is suggested. Call this BEFORE acting on a task a skill covers. Pass "names" to load several at once.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A skill name from the manifest (lenient match)' },
          names: { type: 'array', items: { type: 'string' }, description: 'Optional: load several skills at once' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'install_skills',
      description: 'Install Agent Skills directly from a public GitHub repository — NO git clone needed. Use this when the user pastes a GitHub repo URL or a `git clone …` command for a skills repo (e.g. anthropics/skills) and asks to install/import its skills. Downloads every SKILL.md from the repo into the app\'s default skills folder and installs them. Imported skills arrive DISABLED by default (the user enables the ones they want in the Skills panel) — do not try to enable them yourself. Note: "awesome-*" repos are usually just index lists and contain no SKILL.md.',
      parameters: {
        type: 'object',
        properties: {
          repo: { type: 'string', description: 'The repository: "owner/repo", a full GitHub URL, or a "owner/repo/tree/branch" URL. Examples: "anthropics/skills", "https://github.com/anthropics/skills".' }
        },
        required: ['repo']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Make a surgical edit to an existing file by replacing an exact text snippet. old_string must appear EXACTLY ONCE in the file (include enough surrounding context to be unique). Far cheaper and safer than rewriting the whole file with write_file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The file path to edit' },
          old_string: { type: 'string', description: 'The exact text to find (must be unique in the file UNLESS replace_all is true)' },
          new_string: { type: 'string', description: 'The text to replace it with' },
          replace_all: { type: 'boolean', description: 'Replace ALL occurrences of old_string instead of requiring a single unique match. Use for renaming a variable/string repeated across the file. Default false.' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web (DuckDuckGo). Returns the top results with title, snippet and a clickable source URL — enough to answer or cite WITHOUT navigating each link. USE THIS to verify time-sensitive or "latest/current" facts (library/API versions, prices, releases, recent events) instead of relying on memory, which may be outdated relative to today. Results are cached for 5 minutes, so do NOT repeat the same query; stop searching once you have enough to answer.',
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
      name: 'fetch_url',
      description: 'Read a web page by URL WITHOUT opening a browser window: does a plain HTTP fetch and returns the page title + extracted text. This is the DEFAULT, preferred way to read or scan a page — fast and with no popup window. Use this instead of browser_navigate for reading. If the result is flagged "(thin/JS-rendered)" or you need to click, fill a form, or screenshot, THEN switch to browser_navigate.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to read (https:// prefix added if missing)' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_conversations',
      // Recall cross-sessão (ideia do FTS5 do Hermes, v2.82.2).
      description: 'Search your PAST conversations (other chat sessions) by keyword — long-term recall across sessions. Use when the user refers to something discussed "before/last time/in another chat", or when you need a decision/command/finding from an earlier session. Returns matching snippets grouped by conversation, with how long ago. The CURRENT conversation is excluded (its content is already in your context). Read-only.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords to look for across past conversations' },
          max: { type: 'number', description: 'Max snippets to return (default 8)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'glob_files',
      // Copiado do Glob do Claude Code (v2.82.1): achar arquivos por padrão.
      description: 'Find files by NAME PATTERN (glob) under a directory — e.g. "**/*.ts", "src/**/*.test.tsx", "*.{json,yaml}". Use when you know the name/extension pattern but not the exact path (faster than list_directory or project_tree for locating files). "**/" matches any nesting; "*.ts" matches only the top level. Defaults to the active project folder. Read-only; ignores node_modules/.git/dist and hidden files; depth-limited.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.ts" or "src/**/*.{ts,tsx}"' },
          path: { type: 'string', description: 'Absolute directory to search under. Defaults to the active project folder.' }
        },
        required: ['pattern']
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
      description: 'Open a URL in the built-in browser for INTERACTION — clicking, typing, screenshots, or JS-heavy / login pages. For merely READING a page, use fetch_url instead (faster, opens no window). The browser uses Electron\'s native Chromium, runs HIDDEN by default (no popup), and only becomes visible for visual tools (screenshot / click-by-coordinate). Returns page title, final URL, and extracted text; handles SPAs and JavaScript-rendered pages.',
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
      description: 'Get the text content of the current browser page (the one opened by browser_navigate). Optionally extract from a specific CSS selector. Smart extraction: tries <article> or <main> first, falls back to <body>. For a one-off read without an open browser session, use fetch_url instead.',
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
      description: 'Capture a screenshot of the current browser page (shown in the app browser window) and return its viewport dimensions. Note: the image pixels are NOT sent back to you — to READ page content use browser_get_text or browser_get_forms; use the returned dimensions to target browser_click_at (x,y).',
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
      name: 'computer_open_app',
      description: 'Open an application or file on the Windows desktop (the user\'s real machine), e.g. "notepad", "calc", "explorer", or a full path. Controls the actual OS, not the in-app browser.',
      parameters: {
        type: 'object',
        properties: {
          app: { type: 'string', description: 'Application name or path to open (e.g. "notepad", "C:/path/app.exe")' }
        },
        required: ['app']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_type_text',
      description: 'Type text into whatever window/field currently has focus on the Windows desktop. BLIND action — you cannot see the screen yet, so only use it when you are sure the right field is focused (e.g. right after opening an app). Use computer_press_keys for special keys.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to type at the current cursor' }
        },
        required: ['text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_press_keys',
      description: 'Send a keyboard shortcut/key to the focused window on the Windows desktop, in SendKeys format. Examples: "{ENTER}", "{TAB}", "{ESC}", "^s" (Ctrl+S), "^c" (Ctrl+C), "%{F4}" (Alt+F4). BLIND action. Risky combos (Ctrl/Alt, Delete, Alt+F4) always ask for confirmation first.',
      parameters: {
        type: 'object',
        properties: {
          keys: { type: 'string', description: 'Keys in SendKeys format (^ = Ctrl, % = Alt, + = Shift; named keys in braces)' }
        },
        required: ['keys']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_click',
      // Fusão do ORION no chat (v2.78.0): clique por coordenada no DESKTOP real.
      description: 'Left-click at pixel coordinates (x, y) on the Windows DESKTOP (the user\'s real screen — NOT the in-app browser). Use capture_screen FIRST to see the screen and locate where to click, then click. This is what lets you drive desktop apps visually (see → click → see again) in your own step loop.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'X coordinate in screen pixels (from the left edge)' },
          y: { type: 'number', description: 'Y coordinate in screen pixels (from the top edge)' }
        },
        required: ['x', 'y']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'computer_scroll',
      // Fusão do ORION no chat (v2.78.0): rolar a janela ativa do desktop.
      description: 'Scroll the active Windows DESKTOP window with the mouse wheel. Positive amount scrolls up, negative scrolls down (e.g. -3 = three notches down). Use between capture_screen calls to reveal off-screen content.',
      parameters: {
        type: 'object',
        properties: {
          amount: { type: 'number', description: 'Wheel notches: positive = up, negative = down. Default -3 (down).' }
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
      name: 'git_worktree',
      description: 'Create/remove/list an ISOLATED git worktree for risky or parallel edits, without touching the main working tree. action="add" makes a new worktree on its own branch under .openclaude-worktrees/ (returns the folder path — then write/edit files using full paths inside it, and run/verify there); action="remove" with the path discards it; action="list" shows existing worktrees. Use this when you want to try a change in isolation or run several independent edits in parallel and merge later. Runs in the conversation/project working folder (set it first).',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', description: 'One of: add | remove | list' },
          label: { type: 'string', description: 'For action=add: a short label for the worktree branch/folder (e.g. "refactor-auth")' },
          path: { type: 'string', description: 'For action=remove: the worktree folder path returned by a previous add' }
        },
        required: ['action']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delegate_subtasks',
      description: `Run multiple research subtasks IN PARALLEL. Each subtask is an independent subagent that runs its OWN read-only tool loop (web_search, fetch_url, read_file, search_files, list_directory) — it searches/reads on its own and returns a synthesis. It CANNOT write, edit, or run commands. Use this to fan out independent research/exploration (e.g. "investigate area A", "find where X is defined", "check the latest version of Y") and get all answers at once. Give each subtask a self-contained prompt. Pick a specialized role via "agent". Roles: ${subagentRolesHint()}.`,
      parameters: {
        type: 'object',
        properties: {
          subtasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string', description: 'The instruction for this agent' },
                agent: { type: 'string', description: 'Optional named role: explorer | planner | reviewer | general (default). Prepends a specialized system prompt.' },
                model: { type: 'string', description: 'Optional Ollama model for THIS subtask, chosen from the configured list (see this tool description). Omit to auto-rotate across the configured models.' }
              }
            },
            description: 'List of subtasks to execute in parallel'
          },
          background: { type: 'boolean', description: 'Set true to run the subagents in the BACKGROUND: this returns immediately with a handle and you KEEP WORKING on other independent steps while they run; their results are injected automatically when ready (and awaited before you finish if still pending). Use it when you have other useful work to do meanwhile (the local workers can be slow). Omit/false to wait for the results inline.' }
        },
        required: ['subtasks']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rag_search',
      // Fusão do RAGPanel no chat (v2.73.0): busca semântica na base de
      // conhecimento LOCAL que o usuário indexou. Só aparece como útil quando
      // existe índice — o system prompt avisa (buildRagRouterHint). Read-only.
      description: 'Search the user\'s LOCAL knowledge base — the documents/notes they indexed in the RAG panel — by semantic similarity. Use this when the question can be answered from the user\'s OWN documents, or when they refer to "my docs/files/notes/the document". You are told in the system prompt when an index exists and what sources it has; do NOT call this when there is no knowledge base. Returns the most relevant chunks with their source; cite the source when you use one.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look up in the knowledge base (a natural-language question or keywords)' },
          top_k: { type: 'number', description: 'Optional number of chunks to return (default 5, max 12)' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'capture_screen',
      // Fusão do VisionMode no chat (v2.74.0): a IA "vê" a tela do usuário.
      description: 'Take a screenshot of the user\'s DESKTOP screen and analyze it with a vision model. Use this whenever the user asks about what is on their screen, an error/dialog they are seeing, a chart/graph, a UI, or "look at this / what do you see / what\'s on my screen". Returns a text description — you do not get the pixels, so ask a focused question via "prompt". Reads the screen only (no changes).',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'What to look for or the question about the screen (e.g. "what error is shown?", "describe the chart"). Defaults to a general description.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analyze_image',
      // Fusão do VisionMode no chat (v2.74.0): analisa uma imagem em disco.
      description: 'Analyze an IMAGE FILE on disk (png/jpg/jpeg/gif/webp/bmp) with a vision model. Use when the user points to an image by path, or after you find one via list_directory/search_files and need to understand its contents. Returns a text description. Reads the file only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute path to the image file' },
          prompt: { type: 'string', description: 'What to look for or the question about the image. Defaults to a general description.' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'compare_models',
      // Fusão do ModelArena no chat (v2.75.0): roda o mesmo prompt em N modelos.
      description: 'Run the SAME prompt across 2-4 models and get their answers side by side to compare/synthesize (which is more correct/complete, where they diverge). Use when the user asks to compare models, benchmark, get a "second opinion", or wants a best-of-N answer on a critical question. Each model can be just a name (uses the current provider) or {model, provider} for cross-provider (ollama/openai/gemini/anthropic/openrouter/modal). Note: cloud models cost money per call.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The prompt to send to every model' },
          models: {
            type: 'array',
            description: '2-4 models. Each item is a model name string (current provider) OR an object { model, provider }.',
            items: { type: 'object', properties: { model: { type: 'string' }, provider: { type: 'string' } } }
          }
        },
        required: ['prompt', 'models']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_workflow',
      // Fusão do WorkflowBuilder no chat (v2.76.0): roda um workflow salvo.
      description: 'Run a SAVED automation workflow (built in the workflow panel) by name. The saved workflows and what they do are listed in the system prompt when any exist. Use this instead of planning from scratch when the task matches a saved workflow — it runs the node pipeline deterministically (prompt/command/web/read/write steps, piping output). Requires user approval before running (it may run commands / write files).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'The saved workflow name (or id) to run' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'set_persona',
      // Fusão do PersonaEngine no chat (v2.77.0): adota/troca/limpa a persona.
      description: 'Adopt a PERSONA (a saved character with its own system prompt — e.g. a security expert, a creative writer) for your subsequent replies. Use when the user asks you to take on a specific role, voice, or expertise. The available personas are listed in the system prompt. Pass the persona name, or "default"/"padrão" to clear it and return to the normal assistant. Takes effect on your NEXT reply (not the current turn).',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Persona name (or id) to adopt; "default"/"padrão"/"none" to clear.' }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'project_tree',
      // Fusão do CodeWorkspace no chat (v2.79.0): visão recursiva da estrutura.
      description: 'Get the RECURSIVE file/folder structure of a project directory in ONE call (ignores node_modules/.git/dist/build and hidden files; depth-limited). Use this to quickly understand a codebase layout before reading files — faster than many list_directory calls. Defaults to the active project folder. Read-only.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute directory to map. Defaults to the active project folder.' }
        }
      }
    }
  }
]

// Step-progress guard. NÃO há mais teto numérico de passos do agente (uncap,
// v2.60.0 — escolha do usuário): o loop termina por conclusão da tarefa, botão
// Parar, circuit-breaker (chamadas repetidas) ou ociosidade (abaixo). Este é o
// nº de passos sem progresso tolerados antes de encerrar.
export const IDLE_STEP_THRESHOLD = 5

// Permission sets
export const SAFE_TOOLS = new Set([
  'read_file', 'search_files', 'list_directory', 'web_search', 'fetch_url', 'browser_get_text',
  'browser_get_links', 'browser_get_forms', 'browser_screenshot', 'browser_wait',
  'update_working_memory', 'plan_tasks', 'update_task_status', 'undo_last_write',
  'remember_fact', 'remember_fresh_fact', 'load_skill', 'rag_search',
  'capture_screen', 'analyze_image', 'compare_models', 'set_persona', 'project_tree', 'glob_files',
  'search_conversations', 'get_command_output', 'kill_background_command'
])

export const DANGEROUS_TOOLS = new Set([
  'execute_command', 'run_command_background', 'write_file', 'edit_file', 'open_file_or_url', 'git_command', 'git_worktree',
  'computer_open_app', 'computer_type_text', 'computer_press_keys',
  // ORION no chat (v2.78.0): clique/scroll no desktop real — gateados pela
  // permissão como os demais computer_* (bypass libera p/ power users).
  'computer_click', 'computer_scroll',
  'browser_navigate', 'browser_click', 'browser_type', 'delegate_subtasks',
  // run_workflow pode rodar comandos/escrever arquivos → aprovação como unidade
  'run_workflow',
  // Computer Use — vision-based coordinate interaction
  'browser_click_at', 'browser_type_text', 'browser_key_press', 'browser_scroll',
  // install_skills (v2.155.0): baixa da rede + grava em disco + instala
  // capacidades novas (risco de skill-poisoning) → aprovação do usuário.
  'install_skills',
])
