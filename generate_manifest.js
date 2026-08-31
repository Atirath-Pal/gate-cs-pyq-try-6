const fs = require('fs');
const path = require('path');

const BASE_DIR = path.join(__dirname, 'Previous Year Questions');
const OUTPUT_FILE = path.join(__dirname, 'topic_wise_manifest.json');

function buildManifest() {
  const masterIndex = [];

  if (!fs.existsSync(BASE_DIR)) {
    console.error(`Directory not found: ${BASE_DIR}`);
    return;
  }

  // Read all paper folders inside "Previous Year Questions"
  const paperFolders = fs.readdirSync(BASE_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const folder of paperFolders) {
    const questionsDir = path.join(BASE_DIR, folder, 'questions');
    if (!fs.existsSync(questionsDir)) continue;

    // Scan for question JSON files
    const files = fs.readdirSync(questionsDir)
      .filter(file => file.startsWith('question') && file.endsWith('.json'));

    for (const file of files) {
      const fullPath = path.join(questionsDir, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(raw);

        // Normalize Windows backslashes to standard forward slashes for URL fetching
        const relativePath = path.join('Previous Year Questions', folder, 'questions', file).replace(/\\/g, '/');

        masterIndex.push({
          id: data.id,
          year: data.year,
          set: data.set ?? null,
          topics: Array.isArray(data.topics) ? data.topics.map(t => (typeof t === 'string' ? t.trim() : t)) : [],
          type: data.type,
          correctMarks: data['correct marks'] ?? data.correctMarks ?? null,
          negativeMarks: data['negative marks'] ?? data.negativeMarks ?? null,
          paperFolder: folder,
          filePath: relativePath
        });
      } catch (err) {
        console.error(`Error reading ${fullPath}:`, err.message);
      }
    }
  }

  // Sort questions by year (newest first), then set, then question ID
  masterIndex.sort((a, b) => {
    if (b.year !== a.year) return b.year - a.year;
    if ((a.set || 0) !== (b.set || 0)) return (a.set || 0) - (b.set || 0);
    return a.id - b.id;
  });

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(masterIndex, null, 2), 'utf8');
  console.log(`Successfully generated topic manifest with ${masterIndex.length} entries at: ${OUTPUT_FILE}`);
}

buildManifest();