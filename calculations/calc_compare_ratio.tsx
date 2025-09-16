/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface RatioInputs {
  currentSharePrice: number;
  eps: number; // Earnings Per Share
  sps: number; // Sales Per Share
}


/**
 * Calculates P/E and P/S ratios.
 * @param inputs - The necessary data for the ratio calculations.
 * @returns A string containing the formatted HTML result.
 */
export function calculateRatios(inputs: RatioInputs): string {
    try {
        const { currentSharePrice, eps, sps } = inputs;
        const peRatio = eps > 0 ? (currentSharePrice / eps).toFixed(2) : 'N/A (Negative EPS)';
        const psRatio = sps > 0 ? (currentSharePrice / sps).toFixed(2) : 'N/A';

        return `
            <div class="calculation-result">
                <h4>Valuation Ratios:</h4>
                <p><strong>P/E Ratio (TTM):</strong> ${peRatio}</p>
                <p><strong>P/S Ratio (TTM):</strong> ${psRatio}</p>
            </div>
        `;
    } catch (e) {
        console.error("Ratio Calculation Error:", e);
        return `<p class="error">Error during ratio calculation.</p>`;
    }
}
