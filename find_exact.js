const fs = require('fs');

function findTermLineNumbers(filePath, searchTerm) {
  try {
    // Read the JSON file as raw text
    const fileContent = fs.readFileSync(filePath, 'utf-8');
    
    // Split the text into an array of individual lines
    const lines = fileContent.split(/\r?\n/);
    const lineNumbers = [];
    
    // Loop through each line and check for the search term
    lines.forEach((line, index) => {
      if (line.includes(searchTerm)) {
        // Add 1 to the index because arrays are 0-indexed, but files start at line 1
        lineNumbers.push(index + 1); 
      }
    });
    
    return lineNumbers;
    
  } catch (error) {
    console.error("Error reading the file:", error.message);
    return [];
  }
}

// --- Example Usage ---

// Define your search term and the path to your JSON file
const searchTerm = "Process synchronization"; 
const jsonFilePath = "topic_wise_manifest.json"; // Replace with your actual file path

const resultLines = findTermLineNumbers(jsonFilePath, searchTerm);

if (resultLines.length > 0) {
  console.log(`The term "${searchTerm}" was found on line(s): ${resultLines.join(", ")}`);
} else {
  console.log(`The term "${searchTerm}" was not found in the file.`);
}