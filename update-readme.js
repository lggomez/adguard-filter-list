const fs = require('fs');
const path = require('path');

const blocklistPath = path.join(__dirname, 'blocklist');
const allowlistPath = path.join(__dirname, 'allowlist');
const readmePath = path.join(__dirname, 'README.md');

// Helper to count non-empty lines in a file
function countLines(filePath) {
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split(/\r?\n/).filter(line => line.trim() !== '').length;
}

const blocklistCount = countLines(blocklistPath);
const allowlistCount = countLines(allowlistPath);
const totalCount = blocklistCount + allowlistCount;

const formattedBlocklist = blocklistCount.toLocaleString('en-US');
const formattedAllowlist = allowlistCount.toLocaleString('en-US');
const formattedTotal = totalCount.toLocaleString('en-US');

// Format numbers for shields.io URL (replace commas with %2C)
const blocklistBadgeVal = formattedBlocklist.replace(/,/g, '%2C');
const allowlistBadgeVal = formattedAllowlist.replace(/,/g, '%2C');

const dateStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
});

const statsSection = `<!-- rules-stats-start -->
![Rules Count](https://img.shields.io/badge/Rules-${blocklistBadgeVal}-blue)
![Allowlist Count](https://img.shields.io/badge/Allowlist-${allowlistBadgeVal}-green)

_This combined list was last compiled on **${dateStr} (UTC)** and contains **${formattedBlocklist}** active blocking rules and **${formattedAllowlist}** whitelist exceptions._
<!-- rules-stats-end -->`;

if (fs.existsSync(readmePath)) {
    let readme = fs.readFileSync(readmePath, 'utf-8');
    const hasPlaceholders = readme.includes('<!-- rules-stats-start -->') && readme.includes('<!-- rules-stats-end -->');

    if (hasPlaceholders) {
        readme = readme.replace(/<!-- rules-stats-start -->[\s\S]*?<!-- rules-stats-end -->/, statsSection);
        fs.writeFileSync(readmePath, readme, 'utf-8');
        console.log(`Successfully updated README.md: ${blocklistCount} blocking rules, ${allowlistCount} allowed rules.`);
    } else {
        console.error('Error: Could not find <!-- rules-stats-start --> and <!-- rules-stats-end --> placeholders in README.md');
    }
} else {
    console.error('Error: README.md not found');
}

// Write to GitHub Step Summary if running in GitHub Actions
const githubStepSummary = process.env.GITHUB_STEP_SUMMARY;
if (githubStepSummary) {
    try {
        const summaryText = `

### 📊 Compilation Statistics
| List Type | Rule Count | Description |
| --- | --- | --- |
| 🚫 **Blocklist** | \`${formattedBlocklist}\` | Active DNS blocking rules |
| ✅ **Allowlist** | \`${formattedAllowlist}\` | Separated whitelist exceptions |
| 🗃️ **Total Combined** | \`${formattedTotal}\` | Total unique rules compiled |
`;
        fs.appendFileSync(githubStepSummary, summaryText, 'utf-8');
        console.log('Successfully appended stats to GITHUB_STEP_SUMMARY.');
    } catch (err) {
        console.error('Error writing to GITHUB_STEP_SUMMARY:', err);
    }
}
