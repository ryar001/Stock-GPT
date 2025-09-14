/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI } from '@google/genai';
import { jsPDF } from "jspdf";
import autoTable from 'jspdf-autotable';

// --- Translations ---
type Lang = 'en' | 'es' | 'zh-CN';
const translations = {
  en: {
    title: 'Stock Analyst',
    welcome: 'Welcome! Ask a question about a stock, or select a specific report type below.',
    analysis_type_legend: 'Choose Analysis Type',
    analysis_type_chat: 'Chat',
    placeholder_chat: "Ask about a stock (e.g., 'moat analysis for TSLA')...",
    placeholder_ticker: "Enter a stock ticker...",
  },
  es: {
    title: 'Analista de Acciones',
    welcome: '¡Bienvenido! Haga una pregunta sobre una acción o seleccione un tipo de informe específico a continuación.',
    analysis_type_legend: 'Elija el tipo de análisis',
    analysis_type_chat: 'Chat',
    placeholder_chat: "Pregunte sobre una acción (ej: 'análisis de foso para TSLA')...",
    placeholder_ticker: "Ingrese un símbolo bursátil...",
  },
  'zh-CN': {
    title: '股票分析师',
    welcome: '欢迎！可以提出关于某只股票的问题，或在下方选择特定的报告类型。',
    analysis_type_legend: '选择分析类型',
    analysis_type_chat: '聊天',
    placeholder_chat: "询问关于股票的问题（例如，'TSLA的护城河分析'）...",
    placeholder_ticker: "输入股票代码...",
  }
};
let currentLang: Lang = 'en';

// --- DOM Elements ---
const chatContainer = document.getElementById('chat-container');
const messageList = document.getElementById('message-list');
const chatForm = document.getElementById('chat-form') as HTMLFormElement;
const promptInput = document.getElementById('prompt-input') as HTMLInputElement;
const sendButton = chatForm.querySelector('button');
const analysisOptions = document.getElementById('analysis-options');
const themeToggleButton = document.getElementById('theme-toggle');
const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
const tutorialOverlay = document.getElementById('tutorial-overlay');
const tutorialHighlight = document.getElementById('tutorial-highlight');
const tutorialTooltip = document.getElementById('tutorial-tooltip');
const tutorialTitle = document.getElementById('tutorial-title');
const tutorialDescription = document.getElementById('tutorial-description');
const tutorialSkip = document.getElementById('tutorial-skip');
const tutorialNext = document.getElementById('tutorial-next');

if (!chatContainer || !messageList || !chatForm || !promptInput || !sendButton || !analysisOptions || !themeToggleButton || !languageSelect || !tutorialOverlay || !tutorialHighlight || !tutorialTooltip || !tutorialTitle || !tutorialDescription || !tutorialSkip || !tutorialNext) {
  throw new Error("One or more required DOM elements are missing.");
}

// --- App State ---
const analysisConfigs = new Map<string, any>();
let tutorialSteps: any[] = [];
let currentTutorialStep = 0;

// --- Gemini AI Initialization ---
let ai: GoogleGenAI;
try {
  ai = new GoogleGenAI({apiKey: process.env.API_KEY});
} catch (error) {
    addErrorMessage('Failed to initialize AI. Please check API key and configuration.');
    console.error(error);
    disableChat();
}

/**
 * Loads all analysis configurations from the prompts directory.
 */
async function loadConfigs() {
    try {
        const configFiles = ['chat.json', 'quick_summary.json', 'deep_dive.json', 'technical.json'];
        
        for (const file of configFiles) {
            const response = await fetch(`./prompts/${file}`);
            if (!response.ok) {
                console.warn(`Could not load ${file}, skipping.`);
                continue;
            }
            const config = await response.json();
            if (config.id && config.displayName) {
                analysisConfigs.set(config.id, config);
            } else {
                console.warn(`Skipping ${file} due to missing 'id' or 'displayName'.`);
            }
        }
        
        populateAnalysisOptions();

    } catch (e) {
        console.error("Could not load prompt configurations:", e);
        addErrorMessage('Failed to load analysis configurations. Some features may not work.');
        disableChat();
    }
}


// --- App Initialization ---
(async () => {
    initializeTheme();
    initializeLanguage();
    await loadConfigs();
    buildTutorialSteps();
    if (!localStorage.getItem('hasSeenTutorial')) {
        setTimeout(startTutorial, 500); // Delay for UI to settle
    }
})();


// --- Event Listeners ---
chatForm.addEventListener('submit', handleFormSubmit);
analysisOptions.addEventListener('change', updatePlaceholder);
themeToggleButton.addEventListener('click', toggleTheme);
languageSelect.addEventListener('change', handleLanguageChange);
tutorialSkip.addEventListener('click', endTutorial);
tutorialNext.addEventListener('click', handleTutorialNext);


// --- Core Functions ---

/**
 * Builds a prompt for the conversational chat mode.
 * @param {string} userQuery The user's natural language query.
 * @returns {{systemInstruction: string, contents: string}} The generated prompt object.
 */
function buildChatPrompt(userQuery: string): { systemInstruction: string; contents: string } {
    const chatConfig = analysisConfigs.get('chat');
    if (!chatConfig || analysisConfigs.size <= 1) { // 1 is chat itself
        throw new Error("Analysis configurations not loaded.");
    }

    const allAnalysisStructures = Array.from(analysisConfigs.values())
        .filter(config => config.id !== 'chat') // Exclude chat from the list of reports
        .map(config => {
            if (!config.report_structure || !config.displayName) return '';
            
            const sections = config.report_structure.sections || [{ heading: '', subheadings: config.report_structure.subheadings }];

            const structureDetails = sections
                .map((section: any) => {
                    let sectionInfo = section.heading;
                    if (section.subheadings && section.subheadings.length > 0) {
                        sectionInfo += ` (covers: ${section.subheadings.join(', ')})`;
                    }
                    return sectionInfo;
                })
                .filter(Boolean)
                .join('; ');

            return `- **${config.displayName}**: ${structureDetails}`;
        })
        .join('\n');

    const systemInstruction = chatConfig.system_instruction_template
        .replace('{ALL_ANALYSIS_STRUCTURES}', allAnalysisStructures);

    return { systemInstruction, contents: userQuery };
}

/**
 * Builds the structured text for a quick summary prompt.
 * @param {any[]} sections - The sections from the config.
 * @returns {string} The formatted structure string.
 */
function buildQuickSummaryStructure(sections: any[]): string {
    return sections.map((section: any) => {
        let sectionText = `\n**${section.heading}** ${section.score_guideline || ''}\n`;
        if (section.subheadings && section.subheadings.length > 0) {
            sectionText += section.subheadings.map((sub: string) => `- ${sub}`).join('\n');
        }
        return sectionText;
    }).join('');
}

/**
 * Builds the structured text for a deep dive prompt.
 * @param {any[]} sections - The sections from the config.
 * @returns {string} The formatted structure string.
 */
function buildDeepDiveStructure(sections: any[]): string {
    return sections.map((section: any, index: number) => {
        let sectionText = `\n## ${index + 1}. ${section.heading} ${section.score_guideline ? `(Score: ${section.score_guideline})` : ''}`;
        if (section.subheadings && section.subheadings.length > 0) {
            sectionText += '\n' + section.subheadings.map((sub: string) => `### ${sub}`).join('\n');
        }
        return sectionText;
    }).join('');
}

/**
 * Builds a detailed prompt for the AI based on the analysis type and a ticker.
 * @param {string} analysisType The type of analysis requested (e.g., 'quick_summary').
 * @param {string} ticker The stock ticker.
 * @returns {{systemInstruction: string, contents: string}} The generated prompt object.
 */
function buildPrompt(analysisType: string, ticker: string): { systemInstruction: string; contents: string } {
    const configKey = analysisType === 'full_report' ? 'deep_dive' : analysisType;
    
    if (!analysisConfigs.has(configKey)) {
        throw new Error(`Analysis configuration for '${configKey}' not found.`);
    }

    const config = analysisConfigs.get(configKey);
    let systemInstruction = '';
    let contents = '';
    let structure = '';

    // Determine which structure builder to use based on the config's ID
    if (config.id === 'quick_summary') {
        structure = buildQuickSummaryStructure(config.report_structure.sections);
    } else if (config.id === 'deep_dive') {
        structure = buildDeepDiveStructure(config.report_structure.sections);
    } else if (config.id === 'technical') {
        structure = config.report_structure.subheadings.map((sub: string) => `- ${sub}`).join('\n');
    }

    // Populate system instruction template
    systemInstruction = config.system_instruction_template;
    if (systemInstruction.includes('{STRUCTURE}')) {
        systemInstruction = systemInstruction.replace('{STRUCTURE}', structure);
    }
    if (systemInstruction.includes('{DATA_SOURCES}')) {
        systemInstruction = systemInstruction.replace('{DATA_SOURCES}', config.data_sources.join(', '));
    }
    if (systemInstruction.includes('{DCF_PARAMETERS}')) {
        systemInstruction = systemInstruction.replace('{DCF_PARAMETERS}', JSON.stringify(config.dcf_model_parameters, null, 2));
    }

    // Append citation template if it exists
    if (config.citation_template) {
        systemInstruction += config.citation_template;
    }
    
    // Populate contents (prompt description) template
    contents = config.prompt_description;
    if (contents.includes('{STRUCTURE}')) {
        contents = contents.replace('{STRUCTURE}', structure);
    }
    contents = contents.replace('{TICKER}', ticker);

    return { systemInstruction, contents };
}


/**
 * Handles the submission of the chat form based on selected analysis type.
 * @param {SubmitEvent} e - The form submission event.
 */
async function handleFormSubmit(e: SubmitEvent) {
  e.preventDefault();
  const userInput = promptInput.value.trim();
  const analysisType = (document.querySelector('input[name="analysis-type"]:checked') as HTMLInputElement)?.value;

  if (!userInput || !ai || !analysisType) {
      if (analysisConfigs.size === 0) {
          addErrorMessage('Analysis configuration is still loading or failed to load. Please try again in a moment.');
      }
      return;
  };

  setFormDisabled(true);
  promptInput.value = '';

  let userMessageText = userInput;
  if (analysisType !== 'chat') {
      userMessageText = `${userInput.toUpperCase()} - ${getAnalysisTypeName(analysisType)}`;
  }
  addUserMessage(userMessageText);
  
  const aiMessageElement = addAiMessage('');
  const aiContentElement = aiMessageElement.querySelector('.message-content');
  if (!aiContentElement || !(aiContentElement instanceof HTMLElement)) return;

  showLoadingIndicator(aiContentElement);
  
  try {
    let prompt: { systemInstruction: string; contents: string };
    const ticker = userInput.toUpperCase();

    if (analysisType === 'chat') {
        prompt = buildChatPrompt(userInput);
        await streamResponseToElement(prompt, aiContentElement);
    } else {
        prompt = buildPrompt(analysisType, ticker);
        const fullResponse = await streamResponseToElement(prompt, aiContentElement);

        if (analysisType === 'quick_summary') {
            addGenerateReportButton(aiMessageElement, ticker);
        } else if (analysisType === 'deep_dive') {
            addDownloadPdfButton(aiMessageElement, fullResponse, ticker);
        }
    }

  } catch (error) {
    console.error(error);
    const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
    aiContentElement.innerHTML = `<span class="error">Error: ${errorMessage}</span>`;
  } finally {
    setFormDisabled(false);
    promptInput.focus();
  }
}

/**
 * Converts a simple Markdown string to HTML for display in the chat.
 * Supports: ## H2, ### H3, **bold**, - lists, and clickable links.
 * @param {string} text - The Markdown text.
 * @returns {string} The corresponding HTML.
 */
function markdownToHtml(text: string): string {
    const safeText = text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    
    return safeText
        // Process headers: ## and ### at the start of a line
        .replace(/^## (.*$)/gim, '<h2>$1</h2>')
        .replace(/^### (.*$)/gim, '<h3>$1</h3>')
        // Process bold: **text**
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Process lists: - item at the start of a line
        .replace(/^- (.*$)/gim, '<ul><li>$1</li></ul>')
        // Collapse adjacent list tags to form a single list
        .replace(/<\/ul>\s*<ul>/gim, '')
        // Process links: autolink http/https urls
        .replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}


/**
 * Streams an AI response for a given prompt into a target HTML element.
 * @param {object} prompt - The prompt object with systemInstruction and contents.
 * @param {HTMLElement} targetElement - The element to stream the response into.
 * @returns {Promise<string>} The full response text.
 */
async function streamResponseToElement(prompt: { systemInstruction: string; contents: string }, targetElement: HTMLElement): Promise<string> {
    const responseStream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: prompt.contents,
        config: {
            systemInstruction: prompt.systemInstruction
        }
    });

    let fullResponse = '';
    let firstChunk = true;
    for await (const chunk of responseStream) {
        if (firstChunk) {
            hideLoadingIndicator(targetElement);
            firstChunk = false;
        }
        fullResponse += chunk.text;
        targetElement.innerHTML = markdownToHtml(fullResponse);
    }
    return fullResponse;
}

/**
 * Generates a full PDF report for a ticker and initiates download.
 * @param {string} ticker - The stock ticker.
 * @param {HTMLButtonElement} button - The button that triggered the action.
 */
async function generateAndDownloadPdfReport(ticker: string, button: HTMLButtonElement) {
    button.disabled = true;
    button.textContent = 'Generating...';

    try {
        const prompt = buildPrompt('full_report', ticker);
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt.contents,
            config: {
                systemInstruction: prompt.systemInstruction
            }
        });
        downloadAsPdf(response.text, ticker);

    } catch (error) {
        console.error("PDF Generation Error:", error);
        addErrorMessage(`Failed to generate PDF report for ${ticker}.`);
    } finally {
        button.disabled = false;
        button.textContent = 'Generate Full Report (PDF)';
    }
}

/**
 * Converts text with Markdown into a well-formatted, downloadable PDF file.
 * This version includes robust handling for clickable links within regular text and tables.
 * @param {string} reportText - The text content with Markdown formatting.
 * @param {string} ticker - The stock ticker for the filename.
 */
function downloadAsPdf(reportText: string, ticker: string) {
    try {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });

        const leftMargin = 15;
        const topMargin = 20;
        const contentWidth = doc.internal.pageSize.getWidth() - leftMargin * 2;
        let y = topMargin;

        const addPageNumbers = () => {
            const pageCount = (doc.internal as any).getNumberOfPages();
            doc.setFontSize(9);
            doc.setFont(undefined, 'italic');
            for (let i = 1; i <= pageCount; i++) {
                doc.setPage(i);
                doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() - 10, { align: 'center' });
            }
        };

        const checkPageBreak = (spaceNeeded = 10) => {
            if (y + spaceNeeded > doc.internal.pageSize.getHeight() - 15) {
                doc.addPage();
                y = topMargin;
            }
        };

        // --- Advanced Tokenizer for Bold and Links ---
        type Token = { text: string; isBold: boolean; isLink: boolean; url?: string };
        const tokenizeLine = (line: string): Token[] => {
            const tokens: Token[] = [];
            const regex = /(\*\*.*?\*\*|https?:\/\/[^\s]+)/g;
            let lastIndex = 0;
            let match;

            while ((match = regex.exec(line)) !== null) {
                if (match.index > lastIndex) {
                    tokens.push({ text: line.substring(lastIndex, match.index), isBold: false, isLink: false });
                }

                const matchedText = match[0];
                const isLink = matchedText.startsWith('http');

                if (isLink) {
                    tokens.push({ text: matchedText, isBold: false, isLink: true, url: matchedText });
                } else { // isBold
                    const innerText = matchedText.substring(2, matchedText.length - 2);
                    const innerTokens = tokenizeLine(innerText); // Recursive call
                    innerTokens.forEach(token => tokens.push({ ...token, isBold: true }));
                }
                lastIndex = regex.lastIndex;
            }

            if (lastIndex < line.length) {
                tokens.push({ text: line.substring(lastIndex), isBold: false, isLink: false });
            }
            return tokens;
        };

        const renderFormattedLine = (line: string, x: number, currentY: number, maxWidth: number): number => {
            const originalFontSize = doc.getFontSize();
            doc.setFontSize(10);
            const lineHeight = 5;
            let currentX = x;

            const tokens = tokenizeLine(line);

            tokens.forEach(token => {
                doc.setFont(undefined, token.isBold ? 'bold' : 'normal');
                if (token.isLink) doc.setTextColor(41, 102, 194);

                let remainingText = token.text;
                while (remainingText.length > 0) {
                    let i = remainingText.length;
                    while (doc.getTextWidth(remainingText.substring(0, i)) > (x + maxWidth - currentX)) { i--; }
                    
                    if (i === 0 && currentX > x) {
                        currentY += lineHeight;
                        checkPageBreak(lineHeight);
                        currentX = x;
                        i = remainingText.length;
                        while (doc.getTextWidth(remainingText.substring(0, i)) > maxWidth) { i--; }
                    }
                    if (i === 0 && remainingText.length > 0) { i = 1; } // Prevent infinite loop for very long words

                    const textToPrint = remainingText.substring(0, i);
                    if (token.isLink) {
                        doc.textWithLink(textToPrint, currentX, currentY, { url: token.url || textToPrint });
                    } else {
                        doc.text(textToPrint, currentX, currentY);
                    }
                    currentX += doc.getTextWidth(textToPrint);
                    remainingText = remainingText.substring(i);
                }
                if (token.isLink) doc.setTextColor(51, 51, 51); // Reset text color
            });
            doc.setFontSize(originalFontSize);
            doc.setFont(undefined, 'normal');
            return currentY + lineHeight;
        };
        
        doc.setFontSize(24);
        doc.setFont(undefined, 'bold');
        doc.text(`Financial Analyst Report: ${ticker.toUpperCase()}`, leftMargin, y);
        y += 15;

        const lines = reportText.split('\n');
        let tableLines: string[] = [];
        let inTable = false;

        const renderTable = () => {
            const head = [tableLines[0].split('|').slice(1, -1).map(h => h.trim())];
            const body = tableLines.slice(2).map(row => row.split('|').slice(1, -1).map(cell => cell.trim()));
            
            checkPageBreak(body.length * 10 + 10);
            autoTable(doc, {
                head: head, body: body, startY: y, theme: 'grid',
                headStyles: { fillColor: [26, 35, 126] },
                margin: { left: leftMargin },
                willDrawCell: (data) => {
                    const cellText = data.cell.raw as string;
                    if (typeof cellText === 'string' && /https?:\/\//.test(cellText)) {
                        return false; // Prevent default drawing for cells with links
                    }
                },
                didDrawCell: (data) => {
                    const cellText = data.cell.raw as string;
                    if (typeof cellText === 'string' && /https?:\/\//.test(cellText)) {
                        const cell = data.cell;
                        const x = cell.x + cell.padding('left');
                        let currentY = cell.y + cell.padding('top') + 3; // Approx baseline
                        const maxWidth = cell.width - cell.padding('horizontal');
                        renderFormattedLine(cellText, x, currentY, maxWidth);
                    }
                }
            });
            y = (doc as any).lastAutoTable.finalY + 10;
            inTable = false;
            tableLines = [];
        };

        lines.forEach(line => {
            line = line.trim();
            if (!line) { 
                if (inTable) renderTable();
                y += 5;
                return;
            }

            if (line.includes('|') && line.startsWith('|')) {
                inTable = true;
                tableLines.push(line);
                return;
            }
            
            if (inTable) renderTable();

            checkPageBreak();

            if (line.startsWith('## ')) {
                y += 5;
                doc.setFontSize(16);
                doc.setFont(undefined, 'bold');
                doc.text(line.substring(3), leftMargin, y, { maxWidth: contentWidth });
                y += 10;
            } else if (line.startsWith('### ')) {
                y += 4;
                doc.setFontSize(12);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(63, 81, 181);
                doc.text(line.substring(4), leftMargin, y, { maxWidth: contentWidth });
                doc.setTextColor(51, 51, 51);
                y += 8;
            } else if (line.startsWith('- ')) {
                doc.setFontSize(10);
                doc.setFont(undefined, 'normal');
                const bulletLines = doc.splitTextToSize(`•  ${line.substring(2)}`, contentWidth - 3);
                bulletLines.forEach((bulletLine: string) => {
                    y = renderFormattedLine(bulletLine, leftMargin + 3, y - 5, contentWidth - 3);
                });

            } else {
                 y = renderFormattedLine(line, leftMargin, y, contentWidth);
            }
        });
        if (inTable) renderTable(); // Render table if it's the last element

        addPageNumbers();
        doc.save(`${ticker}_Financial_Analysis.pdf`);
    } catch (e) {
        console.error("Failed to generate PDF:", e);
        addErrorMessage("An error occurred while creating the PDF file.");
    }
}


// --- Tutorial Functions ---

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
function debounce<F extends (...args: any[]) => any>(func: F, wait: number) {
    let timeout: number;
  
    return function executedFunction(...args: Parameters<F>) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
  
      clearTimeout(timeout);
      timeout = window.setTimeout(later, wait);
    };
};

/**
 * Recalculates and shows the current tutorial step. Designed to be called on window resize.
 */
function handleTutorialResize() {
    if (!tutorialOverlay || tutorialOverlay.classList.contains('hidden')) return;
    showTutorialStep(currentTutorialStep);
}

const debouncedResizeHandler = debounce(handleTutorialResize, 150);

/**
 * Builds the sequence of steps for the interactive tutorial.
 */
function buildTutorialSteps() {
    tutorialSteps = [];
    const stepsConfig = [
        { id: 'chat', position: 'bottom' },
        { id: 'quick_summary', position: 'bottom' },
        { id: 'deep_dive', position: 'bottom' },
        { id: 'technical', position: 'bottom' },
        { id: 'prompt-input', position: 'top' },
    ];

    stepsConfig.forEach(stepConf => {
        if (stepConf.id === 'prompt-input') {
            tutorialSteps.push({
                elementId: 'prompt-input',
                title: 'Your Turn!',
                description: 'Enter a stock ticker for a report, or ask any financial question in chat mode to get started.',
                position: 'top',
            });
        } else if (analysisConfigs.has(stepConf.id)) {
            const config = analysisConfigs.get(stepConf.id);
            if (config.description) {
                tutorialSteps.push({
                    elementId: config.id,
                    title: config.displayName,
                    description: config.description,
                    position: stepConf.position,
                });
            }
        }
    });
}

/**
 * Starts the tutorial if it hasn't been seen before.
 */
function startTutorial() {
    if (tutorialSteps.length === 0 || !tutorialOverlay) return;
    currentTutorialStep = 0;
    tutorialOverlay.classList.remove('hidden');
    showTutorialStep(currentTutorialStep);
    window.addEventListener('resize', debouncedResizeHandler);
}

/**
 * Ends the tutorial and saves the state to prevent it from showing again.
 */
function endTutorial() {
    if (!tutorialOverlay) return;
    tutorialOverlay.classList.add('hidden');
    localStorage.setItem('hasSeenTutorial', 'true');
    window.removeEventListener('resize', debouncedResizeHandler);
}

/**
 * Displays a specific step of the tutorial, ensuring the tooltip is always visible.
 * @param {number} index - The index of the step to show.
 */
function showTutorialStep(index: number) {
    if (!tutorialHighlight || !tutorialTooltip || !tutorialTitle || !tutorialDescription || !tutorialNext) return;

    const step = tutorialSteps[index];
    let targetElement: HTMLElement | null;

    if (step.elementId === 'prompt-input') {
        targetElement = document.getElementById(step.elementId);
    } else {
        targetElement = document.querySelector(`label[for="${step.elementId}"]`);
    }

    if (!targetElement) {
        handleTutorialNext(); // Skip if element not found
        return;
    }
    
    const targetRect = targetElement.getBoundingClientRect();
    const padding = 4;
    tutorialHighlight.style.top = `${targetRect.top - padding}px`;
    tutorialHighlight.style.left = `${targetRect.left - padding}px`;
    tutorialHighlight.style.width = `${targetRect.width + padding * 2}px`;
    tutorialHighlight.style.height = `${targetRect.height + padding * 2}px`;

    tutorialTitle.textContent = step.title;
    tutorialDescription.textContent = step.description;

    // We need to wait for the browser to render the new content and calculate the tooltip's size
    requestAnimationFrame(() => {
        const tooltipRect = tutorialTooltip.getBoundingClientRect();
        const margin = 15; // Space between target and tooltip
        const edgeMargin = 10; // Min space from window edge

        // --- Horizontal Positioning ---
        let left = targetRect.left + (targetRect.width / 2) - (tooltipRect.width / 2);
        // Clamp to stay within the window horizontally
        left = Math.max(edgeMargin, Math.min(left, window.innerWidth - tooltipRect.width - edgeMargin));

        // --- Vertical Positioning (with flipping logic) ---
        let top;
        let finalPosition = step.position; // 'top' or 'bottom'

        const spaceBelow = window.innerHeight - targetRect.bottom;
        const spaceAbove = targetRect.top;
        const fitsBelow = spaceBelow >= tooltipRect.height + margin;
        const fitsAbove = spaceAbove >= tooltipRect.height + margin;

        // If preferred position doesn't fit but the other one does, flip it.
        if (step.position === 'bottom' && !fitsBelow && fitsAbove) {
            finalPosition = 'top';
        } else if (step.position === 'top' && !fitsAbove && fitsBelow) {
            finalPosition = 'bottom';
        }
        
        // Apply classes and calculate initial top position
        tutorialTooltip.className = 'tutorial-tooltip'; // Reset classes
        if (finalPosition === 'top') {
            top = targetRect.top - tooltipRect.height - margin;
            tutorialTooltip.classList.add('tooltip-top');
        } else { // 'bottom'
            top = targetRect.bottom + margin;
            tutorialTooltip.classList.add('tooltip-bottom');
        }

        // Clamp to stay within the window vertically
        top = Math.max(edgeMargin, Math.min(top, window.innerHeight - tooltipRect.height - edgeMargin));
        
        tutorialTooltip.style.top = `${top}px`;
        tutorialTooltip.style.left = `${left}px`;
    });

    tutorialNext.textContent = (index === tutorialSteps.length - 1) ? 'Done' : 'Next';
}


/**
 * Handles moving to the next tutorial step or ending the tutorial.
 */
function handleTutorialNext() {
    currentTutorialStep++;
    if (currentTutorialStep < tutorialSteps.length) {
        showTutorialStep(currentTutorialStep);
    } else {
        endTutorial();
    }
}


// --- UI Helper Functions ---

/**
 * Dynamically creates and adds the analysis option radio buttons to the UI.
 */
function populateAnalysisOptions() {
    const fieldset = analysisOptions.querySelector('fieldset');
    if (!fieldset) return;

    fieldset.querySelectorAll('.dynamic-option').forEach(el => el.remove());

    analysisConfigs.forEach(config => {
        if (config.id === 'chat') return;

        const div = document.createElement('div');
        div.className = 'dynamic-option';
        const input = document.createElement('input');
        input.type = 'radio';
        input.id = config.id;
        input.name = 'analysis-type';
        input.value = config.id;

        const label = document.createElement('label');
        label.htmlFor = config.id;
        label.textContent = config.displayName;

        div.appendChild(input);
        div.appendChild(label);
        fieldset.appendChild(div);
    });
}


/**
 * Creates and adds a user message to the chat UI.
 * @param {string} text - The message text.
 */
function addUserMessage(text: string) {
  const messageElement = document.createElement('div');
  messageElement.className = 'message user-message';
  messageElement.innerHTML = `<div class="message-content"><p>${text}</p></div>`;
  messageList.appendChild(messageElement);
  scrollToBottom();
}

/**
 * Creates and adds an AI message container to the chat UI.
 * @param {string} initialText - The initial text (can be empty).
 * @returns {HTMLElement} The created message element.
 */
function addAiMessage(initialText: string): HTMLElement {
  const messageElement = document.createElement('div');
  messageElement.className = 'message ai-message';
  messageElement.innerHTML = `<div class="message-content">${initialText}</div>`;
  messageList.appendChild(messageElement);
  scrollToBottom();
  return messageElement;
}

/**
 * Adds an error message to the chat UI.
 * @param {string} text - The error message text.
 */
function addErrorMessage(text: string) {
    const messageElement = addAiMessage('');
    const content = messageElement.querySelector('.message-content');
    if (content) {
        content.innerHTML = `<span class="error">${text}</span>`;
    }
}

/**
 * Adds a "Generate Full Report (PDF)" button to a message.
 * @param {HTMLElement} messageElement - The AI message element to add the button to.
 * @param {string} ticker - The stock ticker.
 */
function addGenerateReportButton(messageElement: HTMLElement, ticker: string) {
    const button = document.createElement('button');
    button.textContent = 'Generate Full Report (PDF)';
    button.className = 'report-button';
    button.onclick = () => generateAndDownloadPdfReport(ticker, button);
    messageElement.appendChild(button);
    scrollToBottom();
}

/**
 * Adds a "Download as PDF" button to a message.
 * @param {HTMLElement} messageElement - The AI message element to add the button to.
 * @param {string} content - The text content to be used for the PDF.
 * @param {string} ticker - The stock ticker.
 */
function addDownloadPdfButton(messageElement: HTMLElement, content: string, ticker: string) {
    const button = document.createElement('button');
button.textContent = 'Download as PDF';
    button.className = 'report-button';
    button.onclick = () => downloadAsPdf(content, ticker);
    messageElement.appendChild(button);
    scrollToBottom();
}

/** Shows the loading indicator inside a target element. */
function showLoadingIndicator(element: HTMLElement) {
    element.innerHTML = `<div class="loading-indicator"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>`;
    scrollToBottom();
}

/** Hides the loading indicator by clearing the element's content. */
function hideLoadingIndicator(element: HTMLElement) {
    element.innerHTML = '';
}

/** Disables the chat form and button. */
function setFormDisabled(disabled: boolean) {
    promptInput.disabled = disabled;
    sendButton.disabled = disabled;
}

/** Enables the chat form and button. */
function disableChat() {
    promptInput.placeholder = 'Chat disabled due to an error.';
    setFormDisabled(true);
}

/** Scrolls the message list to the bottom. */
function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight;
}

/**
 * Gets the display name for an analysis type value.
 * @param {string} value - The analysis type value (e.g., 'quick_summary').
 * @returns {string} The display-friendly name.
 */
function getAnalysisTypeName(value: string): string {
    if (value === 'chat') {
        const element = document.querySelector(`label[for="chat"]`);
        return element ? element.textContent || 'Chat' : 'Chat';
    }
    return analysisConfigs.get(value)?.displayName || 'Analysis';
}

// --- Theme and Language Functions ---

/** Applies the specified theme to the app. */
function applyTheme(theme: 'light' | 'dark') {
    if (theme === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
}

/** Toggles the theme and saves the preference. */
function toggleTheme() {
    const isDarkMode = document.body.classList.contains('dark-mode');
    const newTheme = isDarkMode ? 'light' : 'dark';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
}

/** Sets the initial theme based on saved preference or system settings. */
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (savedTheme) {
        applyTheme(savedTheme);
    } else if (prefersDark) {
        applyTheme('dark');
    }
}

/** Updates all translatable UI elements to the specified language. */
function updateUI(lang: Lang) {
    currentLang = lang;
    const langStrings = translations[lang];
    document.querySelectorAll('[data-translate-key]').forEach(element => {
        const key = element.getAttribute('data-translate-key');
        if (key && langStrings[key as keyof typeof langStrings]) {
            element.textContent = langStrings[key as keyof typeof langStrings];
        }
    });
    updatePlaceholder();
}

/** Updates the input placeholder text based on selected language and analysis type. */
function updatePlaceholder() {
    const selectedAnalysisType = (document.querySelector('input[name="analysis-type"]:checked') as HTMLInputElement)?.value;
    if (selectedAnalysisType === 'chat') {
        promptInput.placeholder = translations[currentLang].placeholder_chat;
    } else {
        promptInput.placeholder = translations[currentLang].placeholder_ticker;
    }
}

/** Handles language selection change. */
function handleLanguageChange() {
    const newLang = languageSelect.value as Lang;
    updateUI(newLang);
    localStorage.setItem('language', newLang);
}

/** Sets the initial language based on saved preference. */
function initializeLanguage() {
    const savedLang = localStorage.getItem('language') as Lang | null;
    if (savedLang && (savedLang === 'en' || savedLang === 'es' || savedLang === 'zh-CN')) {
        languageSelect.value = savedLang;
        updateUI(savedLang);
    } else {
        updateUI('en'); // Default to English
    }
}