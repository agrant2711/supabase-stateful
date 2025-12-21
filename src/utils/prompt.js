/**
 * Simple prompts using Node.js built-in readline
 * No external dependencies required
 */

import readline from 'readline';

/**
 * Ask a yes/no question with description
 * @param {string} question - The question to ask
 * @param {string} description - Optional description text
 * @param {boolean} defaultValue - Default value if user presses enter
 * @returns {Promise<boolean>}
 */
export async function confirm(question, description = '', defaultValue = true) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hint = defaultValue ? '[Y/n]' : '[y/N]';

  console.log('');
  console.log('───────────────────────────────────────────────────────────────');
  console.log(question);
  if (description) {
    console.log('');
    console.log(description);
  }
  console.log('');

  return new Promise((resolve) => {
    rl.question(`${hint} `, (answer) => {
      rl.close();
      console.log('───────────────────────────────────────────────────────────────');
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(defaultValue);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

/**
 * Ask user to select from a list of options
 * @param {string} question - The question to ask
 * @param {Array<{value: string, label: string}>} options - Options to choose from
 * @param {string} defaultValue - Default option value
 * @returns {Promise<string>} - Selected option value
 */
/**
 * Ask user for free text input
 * @param {string} question - The question/prompt to show
 * @param {string} defaultValue - Default value if user presses enter
 * @returns {Promise<string>} - User's input
 */
export async function input(question, defaultValue = '') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hint = defaultValue ? ` (${defaultValue})` : '';

  return new Promise((resolve) => {
    rl.question(`${question}${hint}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}

export async function select(question, options, defaultValue = null) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('');
  console.log(question);
  options.forEach((opt, idx) => {
    const isDefault = opt.value === defaultValue;
    const marker = isDefault ? '>' : ' ';
    const suffix = isDefault ? ' (default)' : '';
    console.log(`  ${marker} ${idx + 1}. ${opt.label}${suffix}`);
  });

  return new Promise((resolve) => {
    rl.question('Enter number: ', (answer) => {
      rl.close();
      const num = parseInt(answer.trim(), 10);
      if (num >= 1 && num <= options.length) {
        resolve(options[num - 1].value);
      } else if (answer.trim() === '' && defaultValue) {
        resolve(defaultValue);
      } else {
        resolve(options[0].value);
      }
    });
  });
}
