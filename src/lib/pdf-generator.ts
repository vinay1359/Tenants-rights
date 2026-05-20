import { jsPDF } from 'jspdf';
import { AgencyComplaint, CitationCheck, CourtFiling, CounterArgument, DeadlineItem, EvidenceItem, TenantOrg, TimelineEvent, Verdict } from './types';

interface PDFData {
  location: string;
  verdict: Verdict;
  verdictLabel: string;
  explanation: string;
  law: string;
  lawUrl?: string;
  options: string;
  email: string;
  demandLetter?: string;
  orgs: TenantOrg[];
  deadlines?: DeadlineItem[];
  timeline?: TimelineEvent[];
  citation?: CitationCheck;
  counterArguments?: CounterArgument[];
  evidenceChecklist?: { items: EvidenceItem[]; checked: boolean[] };
  agencyComplaint?: AgencyComplaint;
  courtFiling?: CourtFiling;
}

/**
 * Custom robust word wrapper to bypass jsPDF splitTextToSize encoding corruption.
 * Guarantees absolutely pure JavaScript string primitives are passed to doc.text().
 */
function wrapText(text: string, maxChars = 85): string[] {
  if (!text) return [];
  // Normalize string primitives and strip weird non-printable encodings
  const clean = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = clean.split('\n');
  const resultLines: string[] = [];

  for (const p of paragraphs) {
    const trimmed = p.trim();
    if (!trimmed) {
      resultLines.push(''); // preserve empty line spacing
      continue;
    }
    const words = trimmed.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      if ((currentLine + ' ' + word).length > maxChars) {
        if (currentLine) resultLines.push(currentLine.trim());
        currentLine = word;
      } else {
        currentLine = currentLine ? currentLine + ' ' + word : word;
      }
    }
    if (currentLine) resultLines.push(currentLine.trim());
  }

  return resultLines;
}

export function generatePDF(data: PDFData): boolean {
  try {
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    const margin = 20;
    let y = 22;

    function drawHeader() {
      doc.setFillColor(15, 23, 42); // slate-900 banner background
      doc.rect(0, 0, 210, 14, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.text('TENANT RIGHTS CHECKER - SESSION EXPORT', margin, 9);
      
      doc.setTextColor(30, 30, 30);
    }

    // Initialize first page header
    drawHeader();
    y = 26;

    function checkPageBreak(neededSpace: number) {
      if (y + neededSpace > 280) {
        doc.addPage();
        drawHeader();
        y = 24;
      }
    }

    function addHeading(text: string, size = 12, r = 15, g = 23, b = 42) {
      checkPageBreak(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(size);
      doc.setTextColor(r, g, b);
      doc.text(String(text), margin, y);
      y += 6;
    }

    function addBodyLines(text: string | undefined | null, isBold = false, size = 10, maxLen = 85, italic = false) {
      if (!text) return;
      const lines = wrapText(text, maxLen);
      doc.setFontSize(size);
      doc.setFont('helvetica', italic ? 'italic' : isBold ? 'bold' : 'normal');
      doc.setTextColor(40, 40, 40);

      for (const line of lines) {
        checkPageBreak(5);
        if (line) {
          doc.text(line, margin, y);
        }
        y += size * 0.45;
      }
      y += 2; // paragraph margin
    }

    // Title Block
    addHeading('SUMMARY', 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Generated: ${new Date().toLocaleDateString()}  |  Jurisdiction: ${data.location || 'Not Specified'}`, margin, y);
    y += 8;

    // Verdict Block
    checkPageBreak(25);
    const vColors: Record<string, [number, number, number]> = {
      illegal: [185, 28, 28], // red
      grey_area: [180, 83, 9], // amber
      legal: [22, 101, 52], // green
    };
    const color = vColors[data.verdict] || [30, 30, 30];
    
    // Draw background highlight box for verdict
    doc.setFillColor(color[0], color[1], color[2]);
    doc.rect(margin, y, 170, 8, 'F');
    
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(`VERDICT: ${String(data.verdictLabel || data.verdict).toUpperCase()}`, margin + 4, y + 5.5);
    y += 12;

    // Explanation
    addBodyLines(data.explanation, false, 11);
    y += 4;

    // Governing Precedent
    if (data.law) {
      addHeading('GOVERNING PRECEDENT & STATUTES', 12, 37, 99, 235);
      addBodyLines(data.law, false, 10.5, 80, true);
      y += 2;
      if (data.lawUrl) {
        addBodyLines('Official / primary source: ' + data.lawUrl, false, 9, 90);
        y += 2;
      }
      if (data.citation) {
        addBodyLines(
          `Citation confidence: ${data.citation.confidence.toUpperCase()} | Source: ${data.citation.sourceType} | Verified: ${data.citation.verified ? 'yes' : 'no'}`,
          false,
          9,
          90
        );
        addBodyLines(data.citation.note, false, 9, 90, true);
      }
      y += 4;
    }

    // Counter-Arguments Section
    if (data.counterArguments && data.counterArguments.length > 0) {
      addHeading('WHAT YOUR LANDLORD WILL ARGUE', 12, 185, 28, 28);
      for (const arg of data.counterArguments) {
        addBodyLines(`They'll say: "${arg.landlordArgument}"`, false, 10, 80, true);
        addBodyLines(`Why it fails: ${arg.whyItFails}`, false, 9.5, 85);
        addBodyLines(`Have this ready: ${arg.evidenceNeeded}`, false, 9, 85);
        y += 3;
      }
      addBodyLines('Based on how courts in your jurisdiction have interpreted this law.', false, 8, 90, true);
      y += 4;
    }

    if (data.deadlines && data.deadlines.length > 0) {
      addHeading('DEADLINES AND RESPONSE WINDOWS', 12);
      for (const item of data.deadlines) {
        addBodyLines(`${item.priority.toUpperCase()}: ${item.title} - ${item.dateOrWindow}`, true, 10);
        addBodyLines(item.basis, false, 9, 85);
      }
      y += 4;
    }

    if (data.timeline && data.timeline.length > 0) {
      addHeading('CASE TIMELINE', 12);
      for (const item of data.timeline) {
        addBodyLines(`${item.dateOrOrder}: ${item.label}`, true, 10);
        addBodyLines(item.note, false, 9, 85);
      }
      y += 4;
    }

    // Evidence Checklist
    if (data.evidenceChecklist && data.evidenceChecklist.items.length > 0) {
      addHeading('EVIDENCE CHECKLIST', 12);
      const { items, checked } = data.evidenceChecklist;
      for (let i = 0; i < items.length; i++) {
        const status = checked[i] ? '[x]' : '[ ]';
        const label = items[i].critical ? '(ESSENTIAL)' : '(helpful)';
        addBodyLines(`${status} ${label} ${items[i].item}`, false, 9.5, 85);
      }
      const essentialTotal = items.filter(i => i.critical).length;
      const essentialChecked = items.filter((item, idx) => item.critical && checked[idx]).length;
      addBodyLines(`Essential items: ${essentialChecked} of ${essentialTotal} gathered`, true, 9, 85);
      y += 4;
    }

    // Options
    if (data.options) {
      addHeading('RECOMMENDED ENFORCEMENT STRATEGIES', 12);
      addBodyLines(data.options, false, 10);
      y += 4;
    }

    // Email Draft
    if (data.email) {
      addHeading('READY-TO-SEND EMAIL DRAFT', 12, 16, 185, 129);
      addBodyLines(data.email, false, 9.5, 90);
      y += 4;
    }

    // Formal Demand Letter
    if (data.demandLetter) {
      addHeading('FORMAL CERTIFIED DEMAND LETTER (PRE-LITIGATION)', 12, 185, 28, 28);
      addBodyLines(data.demandLetter, false, 9.5, 90);
      y += 4;
    }

    // Escalation Ladder - Agency Complaint
    if (data.agencyComplaint) {
      addHeading('ESCALATION: HOUSING AGENCY COMPLAINT', 12, 37, 99, 235);
      addBodyLines(`Agency: ${data.agencyComplaint.agencyName}`, true, 10);
      addBodyLines(`URL: ${data.agencyComplaint.agencyUrl}`, false, 9, 90);
      addBodyLines(`Filing method: ${data.agencyComplaint.filingMethod}`, false, 9.5, 85);
      addBodyLines(`Timeline: ${data.agencyComplaint.timeline}`, false, 9.5, 85);
      y += 2;
      addBodyLines('Complaint text:', true, 10);
      addBodyLines(data.agencyComplaint.complaintText, false, 9.5, 85);
      y += 4;
    }

    // Escalation Ladder - Court Filing
    if (data.courtFiling) {
      addHeading('ESCALATION: COURT FILING GUIDE', 12, 37, 99, 235);
      addBodyLines(`Court: ${data.courtFiling.courtName}`, true, 10);
      addBodyLines(`URL: ${data.courtFiling.courtUrl}`, false, 9, 90);
      addBodyLines(`Small claims venue: ${data.courtFiling.isSmallClaims ? 'Yes' : 'No'}`, false, 9.5, 85);
      addBodyLines(`Filing fee: ${data.courtFiling.filingFee}`, false, 9.5, 85);
      addBodyLines(`Claims limit: ${data.courtFiling.claimsLimit}`, false, 9.5, 85);
      if (data.courtFiling.whatToBring.length > 0) {
        addBodyLines('What to bring:', true, 10);
        for (const item of data.courtFiling.whatToBring) {
          addBodyLines(`  - ${item}`, false, 9.5, 85);
        }
      }
      y += 2;
      addBodyLines('Statement of claim:', true, 10);
      addBodyLines(data.courtFiling.statementOfClaim, false, 9.5, 85);
      y += 4;
    }

    // Regional Organizations
    if (data.orgs && Array.isArray(data.orgs) && data.orgs.length > 0) {
      addHeading('VERIFIED LOCAL TENANT RESOURCES', 12);
      for (const org of data.orgs) {
        if (!org) continue;
        addBodyLines(`- ${org.name || 'Resource Center'} ${org.phone ? ' (' + org.phone + ')' : ''}`, true, 10);
        if (org.type || org.matchReason) {
          addBodyLines(`  Match: ${org.type || 'resource'}${org.matchReason ? ' - ' + org.matchReason : ''}`, false, 9, 80);
        }
        if (org.url) addBodyLines(`  Link: ${org.url}`, false, 9);
        if (org.note) addBodyLines(`  Note: ${org.note}`, false, 9, 80, true);
        y += 1;
      }
    }

    // Citation Verification Report
    if (data.citation) {
      y += 4;
      addHeading('CITATION VERIFICATION REPORT', 12, 37, 99, 235);
      const statusLabel = data.citation.verified
        ? 'VERIFIED - URL responded successfully'
        : 'UNVERIFIED - could not confirm source URL';
      addBodyLines(`Law cited: ${data.law || 'Not specified'}`, true, 10);
      addBodyLines(`Source type: ${data.citation.sourceType}`, false, 9.5, 85);
      addBodyLines(`Confidence: ${data.citation.confidence.toUpperCase()}`, false, 9.5, 85);
      addBodyLines(`Status: ${statusLabel}`, false, 9.5, 85);
      if (data.lawUrl) {
        addBodyLines(`URL checked: ${data.lawUrl}`, false, 9, 90);
      }
      addBodyLines(data.citation.note, false, 9, 90, true);
      if (!data.citation.verified) {
        addBodyLines(
          `Manual verification: Search for "${data.law}" on your state's official legislature website to confirm.`,
          false,
          9,
          90
        );
      }
      addBodyLines(`Citation verification performed at: ${new Date().toLocaleString()}`, false, 8, 90);
      y += 4;
    }

    // Footer Disclaimer
    y += 6;
    checkPageBreak(12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(140, 140, 140);
    const disclaimerText = 'DISCLAIMER: This legal intelligence document is automatically compiled via AI grounding and public web retrieval. It does not constitute formal legal representation. Review all placeholder fields before formal submission. Consult certified attorneys for localized housing tribunal representation.';
    const discLines = wrapText(disclaimerText, 110);
    for (const dl of discLines) {
      doc.text(dl, margin, y);
      y += 3.5;
    }

    // Save
    const safeLoc = (data.location || 'report').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const filename = `tenant-rights-audit-${safeLoc}-${Date.now()}.pdf`;
    doc.save(filename);
    return true;
  } catch {
    return false;
  }
}
