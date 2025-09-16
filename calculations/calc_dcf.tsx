/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

export interface DcfInputs {
  currentSharePrice: number;
  sharesOutstanding: number; // in millions
  freeCashFlows: number[]; // projected FCFs for next 5 years, in millions
  discountRate: number; // e.g., 0.10 for 10%
  perpetualGrowthRate: number; // e.g., 0.025 for 2.5%
  cashAndEquivalents: number; // in millions
  totalDebt: number; // in millions
}

/**
 * Calculates the intrinsic value of a stock using a Discounted Cash Flow (DCF) model.
 * @param inputs - The necessary data for the DCF calculation.
 * @returns A string containing the formatted HTML result.
 */
export function calculateDCF(inputs: DcfInputs): string {
    try {
        const {
            freeCashFlows,
            discountRate,
            perpetualGrowthRate,
            sharesOutstanding,
            cashAndEquivalents,
            totalDebt,
            currentSharePrice
        } = inputs;

        // 1. Calculate the Present Value of forecasted Free Cash Flows
        const discountedFCFs = freeCashFlows.map((fcf, i) => {
            return fcf / Math.pow(1 + discountRate, i + 1);
        });
        const sumOfDiscountedFCFs = discountedFCFs.reduce((a, b) => a + b, 0);

        // 2. Calculate Terminal Value
        const lastProjectedFCF = freeCashFlows[freeCashFlows.length - 1];
        const terminalValue = (lastProjectedFCF * (1 + perpetualGrowthRate)) / (discountRate - perpetualGrowthRate);

        // 3. Calculate Present Value of Terminal Value
        const discountedTerminalValue = terminalValue / Math.pow(1 + discountRate, freeCashFlows.length);

        // 4. Calculate Enterprise Value
        const enterpriseValue = sumOfDiscountedFCFs + discountedTerminalValue;

        // 5. Calculate Equity Value and Intrinsic Value per Share
        const equityValue = enterpriseValue + cashAndEquivalents - totalDebt;
        const intrinsicValue = equityValue / sharesOutstanding;

        // 6. Compare with current price
        const upsidePercent = ((intrinsicValue - currentSharePrice) / currentSharePrice) * 100;
        const valuation = upsidePercent >= 0 ?
            `<span style="color: #4CAF50;">Undervalued</span> by ${upsidePercent.toFixed(2)}%` :
            `<span style="color: #F44336;">Overvalued</span> by ${Math.abs(upsidePercent).toFixed(2)}%`;

        return `
            <div class="calculation-result">
                <h4>DCF Valuation Result:</h4>
                <p><strong>Intrinsic Value / Share:</strong> $${intrinsicValue.toFixed(2)}</p>
                <p><strong>Current Share Price:</strong> $${currentSharePrice.toFixed(2)}</p>
                <p><strong>Valuation:</strong> ${valuation}</p>
            </div>
        `;
    } catch (e) {
        console.error("DCF Calculation Error:", e);
        return `<p class="error">Error during DCF calculation. Please check the inputs.</p>`;
    }
}
