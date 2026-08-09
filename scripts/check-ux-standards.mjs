import { readFile } from 'node:fs/promises';

const requiredSourceMarkers = {
  'src/App.tsx': [
    "aria-current={activeTab === 'HOME' ? 'page' : undefined}",
    "aria-current={activeTab === 'LOGS' ? 'page' : undefined}",
    "tabIndex={isNavOpen ? 0 : -1}",
    'min-h-16 min-w-16',
  ],
  'src/components/Auth.tsx': [
    'aria-pressed={visible}',
    'min-h-11 min-w-11',
  ],
  'src/components/UserPanel.tsx': [
    'aria-label={`ทำแบบทดสอบ ${title} ใหม่`}',
    'flex min-h-11 min-w-11',
  ],
};

for (const [file, markers] of Object.entries(requiredSourceMarkers)) {
  const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
  for (const marker of markers) {
    if (!source.includes(marker)) {
      throw new Error(`UX standards check failed: ${file} is missing ${marker}`);
    }
  }
}

console.log('UX standards check passed: mobile navigation, PIN controls, and core actions retain accessibility markers.');
