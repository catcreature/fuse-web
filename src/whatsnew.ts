// What's new, newest first. Every release: add its lines here, written for the user in plain words,
// and bump "version" in package.json.

export const WHATS_NEW: [string, string[]][] = [
  ['0.4.3', [
    'Smaller text, the size the Emberr app draws at: its 15 pt body over 13 pt labels.',
    'Settings, Look, Text size: the same five steps the Emberr app has, Extra small to Extra large.',
  ]],
  ['0.4.2', [
    'Glass: the frosted chrome the Emberr app has. Settings, Look, Glass — on by default.',
    'Sheets blur the page behind them, and the Undo bar and add bar are frosted panes.',
  ]],
  ['0.4.1', [
    'Finished tasks fold away. They now sit behind a "3 done" row at the bottom of the list — tap it to open or close them, and Fuse remembers which you chose.',
    'They start folded, so the list shows what is still burning.',
  ]],
  ['0.4.0', [
    'A new look, taken from the Emberr app: Settings, Look, Palette.',
    'Emberr is what Fuse now opens with — a white page with flat grey cards, a hairline edge instead of a shadow, and Poppins type. Soft is the same in gentler greys.',
    'Both are monochrome, as the Emberr app is: chips, buttons and headings go black on the light page and white on the dark one. Your fuse still burns through amber to red.',
    'Prefer the old look? Pick Fuse in the same place. The five accent colours apply to it.',
  ]],
  ['0.3.1', [
    'A simpler look: just your list, with History and Settings at the top.',
    'Fits any window, from a phone to a wide screen; on a big screen, Burned out recently and sync sit beside the list.',
    'Backup and restore moved into Settings.',
    'The website now wears the Fuse app\'s own icon.',
  ]],
  ['0.3.0', [
    'Settings (the gear): theme, accent colour, quiet hours, Strict 24 h and Calm mode.',
    'A History page: search what you did, bring a task back, or clear it all.',
    'Tasks that burned out in the last 12 hours show under Burned out recently: bring them back or let them go.',
    'Sync with the Fuse app on your phone through your GitHub: Settings, Sync.',
  ]],
  ['0.2.0', [
    'Install Fuse like an app (Install in your browser\'s menu), and it works offline.',
    'Alerts now arrive as system notifications when you allow them, while Fuse is open.',
    'Tap a task to edit it: notes, priority, a warning time, a reminder, repeat every day, and Add time (up to 3 times).',
    'Tap + with the bar empty for a new task with everything, including a Custom length from 5 minutes to 7 days.',
    'Sort by what burns out first, priority, newest or oldest. Touch and hold a task (or drag it with the mouse) to move it; Alt+Up/Down with the keyboard.',
  ]],
  ['0.1.0', [
    'Fuse now runs in a browser: add tasks, tick them, and watch each one burn down over its 24 hours.',
    'Bring your tasks over from the Android app with Restore a backup.',
  ]],
];

/** Every line newer than seen, newest first; all of them when seen is blank. */
export function whatsNew(seen: string): string[] {
  const out: string[] = [];
  for (const [version, lines] of WHATS_NEW) {
    if (version === seen) break;
    out.push(...lines);
  }
  return out;
}
