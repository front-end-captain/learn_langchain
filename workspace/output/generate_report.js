const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation, LevelFormat,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  TabStopType, TabStopPosition, PageBreak, PageNumber
} = require('docx');
const fs = require('fs');

// Helper: create a border config
const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const headerBorder = { style: BorderStyle.SINGLE, size: 1, color: "2E75B6" };
const headerBorders = { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder };

// Helper: create a table cell
function makeCell(text, opts = {}) {
  const { bold = false, align = AlignmentType.LEFT, shading = null, fontSize = 20, font = "Arial" } = opts;
  return new TableCell({
    borders,
    width: opts.cellWidth ? { size: opts.cellWidth, type: WidthType.DXA } : undefined,
    shading: shading ? { fill: shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(text), bold, font, size: fontSize })]
    })]
  });
}

// Helper: create a header row cell
function makeHeaderCell(text, opts = {}) {
  const { align = AlignmentType.LEFT, cellWidth } = opts;
  return new TableCell({
    borders: headerBorders,
    width: cellWidth ? { size: cellWidth, type: WidthType.DXA } : undefined,
    shading: { fill: "2E75B6", type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(text), bold: true, font: "Arial", size: 20, color: "FFFFFF" })]
    })]
  });
}

// Helper: create a simple paragraph
function makePara(text, opts = {}) {
  const { bold = false, fontSize = 24, font = "Arial", align = AlignmentType.LEFT, heading = undefined, spacing = {} } = opts;
  return new Paragraph({
    heading,
    alignment: align,
    spacing: { before: opts.before || 0, after: opts.after || 80, ...spacing },
    children: [new TextRun({ text, bold, font, size: fontSize })]
  });
}

// Helper: create a bullet paragraph
function makeBullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, font: "Arial", size: 22 })]
  });
}

// Helper: create a numbered paragraph
function makeNumbered(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { before: 40, after: 40 },
    children: [new TextRun({ text, font: "Arial", size: 22 })]
  });
}

// Helper: create a multi-run paragraph
function makeMultiRunPara(runs, opts = {}) {
  const { bold = false, fontSize = 22, align = AlignmentType.LEFT, spacing = {} } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { before: opts.before || 0, after: opts.after || 80, ...spacing },
    children: runs.map(r => new TextRun({ ...r, font: "Arial", size: r.size || fontSize }))
  });
}

// Helper: create a section break paragraph
function sectionBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

// Build the document
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Arial", size: 24 } }
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 300, after: 200 }, outlineLevel: 0 }
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "Arial", color: "2E75B6" },
        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 }
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "Arial", color: "4472C4" },
        paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 2 }
      }
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      },
      {
        reference: "numbers",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      }
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [
            new TextRun({ text: "星云科技股份有限公司", font: "Arial", size: 18, color: "808080" }),
            new TextRun({ text: "  |  ", font: "Arial", size: 18, color: "808080" }),
            new TextRun({ text: "2025\u5E74\u7B2C\u4E09\u5B63\u5EA6\u4E1A\u7EE9\u62A5\u544A", font: "Arial", size: 18, color: "808080" })
          ]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "\u5185\u90E8\u4F7F\u7528  |  \u9875\u7801 ", font: "Arial", size: 18, color: "808080" }),
            new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 18, color: "808080" })
          ]
        })]
      })
    },
    children: [
      // ==================== PAGE 1: COVER ====================
      new Paragraph({ spacing: { before: 3600 }, alignment: AlignmentType.CENTER, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: "2E75B6", space: 1 } },
        spacing: { after: 400 },
        children: [new TextRun({ text: "\u661F\u4E91\u79D1\u6280\u80A1\u4EFD\u6709\u9650\u516C\u53F8", font: "Arial", size: 44, bold: true, color: "2E75B6" })]
      }),
      new Paragraph({ spacing: { before: 200, after: 200 }, alignment: AlignmentType.CENTER, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "2025\u5E74\u7B2C\u4E09\u5B63\u5EA6\u4E1A\u7EE9\u62A5\u544A", font: "Arial", size: 36, bold: true, color: "333333" })]
      }),
      new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "\u62A5\u544A\u671F\u95F4\uFF1A2025\u5E747\u67081\u65E5 \u2014 2025\u5E749\u670830\u65E5", font: "Arial", size: 24, color: "555555" })]
      }),
      new Paragraph({ spacing: { before: 120 }, alignment: AlignmentType.CENTER, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "\u53D1\u5E03\u65E5\u671F\uFF1A2025\u5E7410\u670828\u65E5", font: "Arial", size: 24, color: "555555" })]
      }),
      new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "\u5BC6\u7EA7\uFF1A\u5185\u90E8\u4F7F\u7528", font: "Arial", size: 24, bold: true, color: "C00000" })]
      }),
      new Paragraph({ spacing: { before: 2400 }, alignment: AlignmentType.CENTER, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "\u672C\u62A5\u544A\u4EC5\u4F9B\u516C\u53F8\u5185\u90E8\u4F7F\u7528\uFF0C\u8BF7\u59A5\u5584\u4FDD\u7BA1", font: "Arial", size: 18, color: "999999" })]
      }),

      sectionBreak(),

      // ==================== PAGE 2: EXECUTIVE SUMMARY ====================
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "\u4E00\u3001\u6267\u884C\u6458\u8981", font: "Arial" })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "1.1 \u8425\u6536\u6982\u89C8", font: "Arial" })] }),
      makeMultiRunPara([
        { text: "Q3 2025\u8425\u6536\u8FBE ", bold: false },
        { text: "42.7\u4EBF\u5143", bold: true, color: "2E75B6" },
        { text: "\uFF0C\u540C\u6BD4\u589E\u957F ", bold: false },
        { text: "23.4%", bold: true, color: "00B050" },
        { text: "\uFF0C\u73AF\u6BD4\u589E\u9579 ", bold: false },
        { text: "8.1%", bold: true, color: "00B050" },
        { text: "\uFF0C\u8D85\u51FA\u5E02\u573A\u9884\u671F ", bold: false },
        { text: "5.2\u4E2A\u767E\u5206\u70B9", bold: true, color: "00B050" },
        { text: "\u3002", bold: false }
      ], { after: 120 }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "1.2 \u51C0\u5229\u6DA6\u6982\u89C8", font: "Arial" })] }),
      makeMultiRunPara([
        { text: "Q3 2025\u51C0\u5229\u6DA6\u8FBE ", bold: false },
        { text: "6.3\u4EBF\u5143", bold: true, color: "2E75B6" },
        { text: "\uFF0C\u51C0\u5229\u7387\u4E3A ", bold: false },
        { text: "14.8%", bold: true, color: "00B050" },
        { text: "\uFF0C\u540C\u6BD4\u63D0\u5347 ", bold: false },
        { text: "2.1\u4E2A\u767E\u5206\u70B9", bold: true, color: "00B050" },
        { text: "\u3002", bold: false }
      ], { after: 120 }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "1.3 \u5173\u952E\u91CC\u7A0B\u7891", font: "Arial" })] }),
      makeBullet("\u4E91\u8BA1\u7B97\u4E1A\u52A1\u9996\u6B21\u7A81\u7834\u767E\u4EBF\u5E74\u5316\u8425\u6536\u91CC\u7A0B\u7891"),
      makeBullet("AI \u5927\u6A21\u578B API \u8C03\u7528\u91CF\u73AF\u6BD4\u589E\u9579 156%"),
      makeBullet("\u4F01\u4E1A\u5BA2\u6237\u6570\u91CF\u8FBE\u5230 12,847 \u5BB6\uFF0C\u8F83\u4E0A\u5B63\u5EA6\u51C0\u589E 1,203 \u5BB6"),
      makeBullet("\u6D77\u5916\u5E02\u573A\u6536\u5165\u5360\u6BD4\u63D0\u5347\u81F3 18.3%"),
      makeBullet("\u4E1C\u5357\u4E9A\u533A\u57DF\u589E\u901F\u8FBE 67%"),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "1.4 \u8463\u4E8B\u4F1A\u51B3\u8BAE", font: "Arial" })] }),
      makeMultiRunPara([
        { text: "\u672C\u5B63\u5EA6\u4E0D\u6D3E\u53D1\u4E2D\u671F\u80A1\u606F\uFF0C\u5229\u6DA6\u7559\u5B58\u7528\u4E8E AI \u57FA\u7840\u8BBE\u65BD\u5EFA\u8BBE\u3002\u5168\u5E74\u8BA1\u5212\u8D44\u672C\u652F\u51FA ", bold: false },
        { text: "28\u4EBF\u5143", bold: true, color: "2E75B6" },
        { text: "\uFF0C\u540C\u6BD4\u589E\u9579 ", bold: false },
        { text: "40%", bold: true, color: "00B050" },
        { text: "\u3002", bold: false }
      ], { after: 120 }),

      sectionBreak(),

      // ==================== PAGE 3: CORE FINANCIAL DATA ====================
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "\u4E8C\u3001\u6838\u5FC3\u8D22\u52A1\u6570\u636E", font: "Arial" })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "2.1 \u5B63\u5EA6\u5BF9\u6BD4\u5206\u6790", font: "Arial" })] }),

      // Financial comparison table
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2200, 1200, 1200, 1200, 1200, 1200, 1160],
        rows: [
          // Header row
          new TableRow({
            children: [
              makeHeaderCell("\u6307\u6807", { cellWidth: 2200 }),
              makeHeaderCell("\u5355\u4F4D", { cellWidth: 1200, align: AlignmentType.CENTER }),
              makeHeaderCell("Q3 2025", { cellWidth: 1200, align: AlignmentType.CENTER }),
              makeHeaderCell("Q2 2025", { cellWidth: 1200, align: AlignmentType.CENTER }),
              makeHeaderCell("Q3 2024", { cellWidth: 1200, align: AlignmentType.CENTER }),
              makeHeaderCell("\u540C\u6BD4\u53D8\u5316", { cellWidth: 1200, align: AlignmentType.CENTER }),
              makeHeaderCell("\u73AF\u6BD4\u53D8\u5316", { cellWidth: 1160, align: AlignmentType.CENTER }),
            ]
          }),
          // Row 1: 营业收入
          new TableRow({
            children: [
              makeCell("\u8425\u4E1A\u6536\u5165", { bold: true }),
              makeCell("\u4EBF\u5143", { align: AlignmentType.CENTER }),
              makeCell("42.7", { align: AlignmentType.CENTER, bold: true }),
              makeCell("39.5", { align: AlignmentType.CENTER }),
              makeCell("34.6", { align: AlignmentType.CENTER }),
              makeCell("+23.4%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("+8.1%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
          // Row 2: 毛利润
          new TableRow({
            children: [
              makeCell("\u6BDB\u5229\u6DA6", { bold: true }),
              makeCell("\u4EBF\u5143", { align: AlignmentType.CENTER }),
              makeCell("19.8", { align: AlignmentType.CENTER, bold: true }),
              makeCell("18.1", { align: AlignmentType.CENTER }),
              makeCell("15.4", { align: AlignmentType.CENTER }),
              makeCell("+28.6%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("+9.4%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
          // Row 3: 毛利率
          new TableRow({
            children: [
              makeCell("\u6BDB\u5229\u7387"),
              makeCell("%", { align: AlignmentType.CENTER }),
              makeCell("46.4", { align: AlignmentType.CENTER, bold: true }),
              makeCell("45.8", { align: AlignmentType.CENTER }),
              makeCell("44.5", { align: AlignmentType.CENTER }),
              makeCell("+1.9pp", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("+0.6pp", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
          // Row 4: 净利润
          new TableRow({
            children: [
              makeCell("\u51C0\u5229\u6DA6", { bold: true }),
              makeCell("\u4EBF\u5143", { align: AlignmentType.CENTER }),
              makeCell("6.3", { align: AlignmentType.CENTER, bold: true }),
              makeCell("5.7", { align: AlignmentType.CENTER }),
              makeCell("4.8", { align: AlignmentType.CENTER }),
              makeCell("+31.3%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("+10.5%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
          // Row 5: 净利率
          new TableRow({
            children: [
              makeCell("\u51C0\u5229\u7387"),
              makeCell("%", { align: AlignmentType.CENTER }),
              makeCell("14.8", { align: AlignmentType.CENTER, bold: true }),
              makeCell("14.4", { align: AlignmentType.CENTER }),
              makeCell("13.9", { align: AlignmentType.CENTER }),
              makeCell("+0.9pp", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("+0.4pp", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
          // Row 6: 经营现金流
          new TableRow({
            children: [
              makeCell("\u7ECF\u8425\u73B0\u91D1\u6D41", { bold: true }),
              makeCell("\u4EBF\u5143", { align: AlignmentType.CENTER }),
              makeCell("8.1", { align: AlignmentType.CENTER, bold: true }),
              makeCell("7.4", { align: AlignmentType.CENTER }),
              makeCell("6.2", { align: AlignmentType.CENTER }),
              makeCell("+30.6%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("+9.5%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
          // Row 7: 研发投入
          new TableRow({
            children: [
              makeCell("\u7814\u53D1\u6295\u5165", { bold: true }),
              makeCell("\u4EBF\u5143", { align: AlignmentType.CENTER }),
              makeCell("5.4", { align: AlignmentType.CENTER, bold: true }),
              makeCell("5.1", { align: AlignmentType.CENTER }),
              makeCell("4.0", { align: AlignmentType.CENTER }),
              makeCell("+35.0%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("+5.9%", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
          // Row 8: 研发投入占收入比
          new TableRow({
            children: [
              makeCell("\u7814\u53D1\u6295\u5165\u5360\u6536\u5165\u6BD4"),
              makeCell("%", { align: AlignmentType.CENTER }),
              makeCell("12.6", { align: AlignmentType.CENTER, bold: true }),
              makeCell("12.9", { align: AlignmentType.CENTER }),
              makeCell("11.6", { align: AlignmentType.CENTER }),
              makeCell("+1.0pp", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
              makeCell("-0.3pp", { align: AlignmentType.CENTER, bold: true, fontSize: 18 }),
            ]
          }),
        ]
      }),

      sectionBreak(),

      // ==================== PAGE 4: BUSINESS SEGMENTS ====================
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "\u4E09\u3001\u4E1A\u52A1\u677F\u5757\u5206\u6790", font: "Arial" })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "3.1 \u56DB\u5927\u4E1A\u52A1\u677F\u5757\u6536\u5165\u6784\u6210", font: "Arial" })] }),

      // Business segments table
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2600, 1600, 1400, 1600, 1400, 760],
        rows: [
          // Header row
          new TableRow({
            children: [
              makeHeaderCell("\u4E1A\u52A1\u677F\u5757", { cellWidth: 2600 }),
              makeHeaderCell("\u6536\u5165\uFF08\u4EBF\u5143\uFF09", { cellWidth: 1600, align: AlignmentType.CENTER }),
              makeHeaderCell("\u6536\u5165\u5360\u6BD4", { cellWidth: 1400, align: AlignmentType.CENTER }),
              makeHeaderCell("\u540C\u6BD4\u589E\u957F", { cellWidth: 1600, align: AlignmentType.CENTER }),
              makeHeaderCell("\u6BDB\u5229\u7387", { cellWidth: 1400, align: AlignmentType.CENTER }),
              makeHeaderCell("\u73AF\u6BD4\u589E\u957F", { cellWidth: 760, align: AlignmentType.CENTER }),
            ]
          }),
          // Row 1: 云计算与基础设施
          new TableRow({
            children: [
              makeCell("\u4E91\u8BA1\u7B97\u4E0E\u57FA\u7840\u8BBE\u65BD", { bold: true }),
              makeCell("21.3", { align: AlignmentType.CENTER, bold: true }),
              makeCell("49.9%", { align: AlignmentType.CENTER }),
              makeCell("+41.2%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, color: "00B050" }),
              makeCell("38.2%", { align: AlignmentType.CENTER }),
              makeCell("\u2014", { align: AlignmentType.CENTER }),
            ]
          }),
          // Row 2: AI 大模型与 API 服务
          new TableRow({
            children: [
              makeCell("AI \u5927\u6A21\u578B\u4E0E API \u670D\u52A1", { bold: true }),
              makeCell("9.8", { align: AlignmentType.CENTER, bold: true }),
              makeCell("22.9%", { align: AlignmentType.CENTER }),
              makeCell("+187.0%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, color: "00B050" }),
              makeCell("52.4%", { align: AlignmentType.CENTER }),
              makeCell("+34.0%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, color: "00B050" }),
            ]
          }),
          // Row 3: 企业软件与 SaaS
          new TableRow({
            children: [
              makeCell("\u4F01\u4E1A\u8F6F\u4EF6\u4E0E SaaS", { bold: true }),
              makeCell("8.6", { align: AlignmentType.CENTER, bold: true }),
              makeCell("20.1%", { align: AlignmentType.CENTER }),
              makeCell("+12.3%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, color: "00B050" }),
              makeCell("61.7%", { align: AlignmentType.CENTER }),
              makeCell("\u2014", { align: AlignmentType.CENTER }),
            ]
          }),
          // Row 4: 专业服务与咨询
          new TableRow({
            children: [
              makeCell("\u4E13\u4E1A\u670D\u52A1\u4E0E\u54A8\u8BE2", { bold: true }),
              makeCell("3.0", { align: AlignmentType.CENTER, bold: true }),
              makeCell("7.0%", { align: AlignmentType.CENTER }),
              makeCell("+8.7%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, color: "00B050" }),
              makeCell("35.2%", { align: AlignmentType.CENTER }),
              makeCell("\u2014", { align: AlignmentType.CENTER }),
            ]
          }),
          // Total row
          new TableRow({
            children: [
              makeCell("\u5408\u8BA1", { bold: true, shading: "E8E8E8" }),
              makeCell("42.7", { align: AlignmentType.CENTER, bold: true, shading: "E8E8E8" }),
              makeCell("100.0%", { align: AlignmentType.CENTER, shading: "E8E8E8" }),
              makeCell("+23.4%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, shading: "E8E8E8" }),
              makeCell("46.4%", { align: AlignmentType.CENTER, shading: "E8E8E8" }),
              makeCell("+8.1%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, shading: "E8E8E8" }),
            ]
          }),
        ]
      }),

      new Paragraph({ spacing: { before: 200 }, children: [] }),
      makeMultiRunPara([
        { text: "\u4E1A\u52A1\u4EAE\u70B9\uFF1A", bold: true, size: 22 },
        { text: "\u4E91\u8BA1\u7B97\u4E0E\u57FA\u7840\u8BBE\u65BD\u9996\u6B21\u6210\u4E3A\u6700\u5927\u6536\u5165\u6765\u6E90\uFF08\u5360\u6BD4 49.9%\uFF09\uFF0C\u5E74\u5316\u8425\u6536\u7A81\u7834\u767E\u4EBF\u3002AI \u5927\u6A21\u578B\u4E0E API \u670D\u52A1\u7206\u53D1\u5F0F\u589E\u957F\uFF0C\u540C\u6BD4\u589E\u9579 187%\uFF0C\u73AF\u6BD4\u589E\u9579 34%\uFF0C\u5DF2\u6210\u4E3A\u516C\u53F8\u7B2C\u4E8C\u589E\u957F\u66F2\u7EBF\u3002", size: 22 }
      ], { after: 120 }),

      sectionBreak(),

      // ==================== PAGE 5: RISK FACTORS ====================
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "\u56DB\u3001\u98CE\u9669\u56E0\u7D20", font: "Arial" })] }),
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "4.1 \u4E3B\u8981\u98CE\u9669\u53CA\u9884\u4F30\u5F71\u54CD", font: "Arial" })] }),

      // Risk factors table
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2800, 3200, 3360],
        rows: [
          // Header row
          new TableRow({
            children: [
              makeHeaderCell("\u98CE\u9669\u7C7B\u522B", { cellWidth: 2800 }),
              makeHeaderCell("\u98CE\u9669\u63CF\u8FF0", { cellWidth: 3200 }),
              makeHeaderCell("\u9884\u4F30\u5F71\u54CD", { cellWidth: 3360 }),
            ]
          }),
          // Row 1: 宏观经济压力
          new TableRow({
            children: [
              makeCell("\u5B8F\u89C2\u7ECF\u6D4E\u538B\u529B", { bold: true }),
              makeCell("\u5168\u7403\u7ECF\u6D4E\u589E\u901F\u653E\u7F13\uFF0C\u4F01\u4E1A IT \u652F\u51FA\u53EF\u80FD\u627F\u538B"),
              makeCell("Q4 \u6536\u5165\u5F71\u54CD\u7EA6 1.5 \u4EBF\u5143", { bold: true, fontSize: 18, color: "C00000" }),
            ]
          }),
          // Row 2: 竞争加剧
          new TableRow({
            children: [
              makeCell("\u7ADE\u4E89\u52A0\u5267", { bold: true }),
              makeCell("AI \u8D5B\u9053\u7ADE\u4E89\u8005\u589E\u591A\uFF0CAPI \u5355\u4EF7\u9762\u4E34\u4E0B\u964D\u538B\u529B"),
              makeCell("\u6BDB\u5229\u7387\u53EF\u80FD\u538B\u7F29 1-2pp", { bold: true, fontSize: 18, color: "C00000" }),
            ]
          }),
          // Row 3: 人才成本上升
          new TableRow({
            children: [
              makeCell("\u4EBA\u624D\u6210\u672C\u4E0A\u5347", { bold: true }),
              makeCell("\u9AD8\u7AEF\u6280\u672F\u4EBA\u624D\u4E89\u593A\u6FC0\u70C8\uFF0C\u85AA\u916C\u6C34\u5E73\u6301\u7EED\u4E0A\u6DA8"),
              makeCell("Q3 \u4EBA\u529B\u6210\u672C\u540C\u6BD4\u589E\u9579 38%", { bold: true, fontSize: 18, color: "C00000" }),
            ]
          }),
          // Row 4: 海外合规
          new TableRow({
            children: [
              makeCell("\u6D77\u5916\u5408\u89C4", { bold: true }),
              makeCell("\u5404\u56FD\u6570\u636E\u5408\u89C4\u8981\u6C42\u65E5\u8D8B\u4E25\u683C\uFF0C\u5408\u89C4\u6210\u672C\u6301\u7EED\u589E\u52A0"),
              makeCell("\u989D\u5916\u5408\u89C4\u6210\u672C\u7EA6 0.8 \u4EBF\u5143", { bold: true, fontSize: 18, color: "C00000" }),
            ]
          }),
        ]
      }),

      sectionBreak(),

      // ==================== PAGE 6: Q4 & FULL YEAR GUIDANCE ====================
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "\u4E94\u3001Q4 \u53CA\u5168\u5E74\u6307\u5F15", font: "Arial" })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "5.1 Q4 2025 \u8425\u6536\u6307\u5F15", font: "Arial" })] }),
      makeMultiRunPara([
        { text: "Q4 2025\u8425\u6536\u9884\u8BA1\u533A\u95F4\u4E3A ", bold: false },
        { text: "45.0 \u2014 47.5 \u4EBF\u5143", bold: true, color: "2E75B6" },
        { text: "\uFF0C\u540C\u6BD4\u589E\u9579\u8303\u56F4\u4E3A ", bold: false },
        { text: "19% \u2014 26%", bold: true, color: "00B050" },
        { text: "\u3002", bold: false }
      ], { after: 120 }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "5.2 Q4 2025 \u51C0\u5229\u6DA6\u6307\u5F15", font: "Arial" })] }),
      makeMultiRunPara([
        { text: "Q4 2025\u51C0\u5229\u6DA6\u9884\u8BA1\u533A\u95F4\u4E3A ", bold: false },
        { text: "6.5 \u2014 7.2 \u4EBF\u5143", bold: true, color: "2E75B6" },
        { text: "\u3002", bold: false }
      ], { after: 120 }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "5.3 \u5168\u5E74\u6536\u5165\u6307\u5F15", font: "Arial" })] }),
      makeMultiRunPara([
        { text: "2025\u5168\u5E74\u6536\u5165\u6307\u5F15\u8303\u56F4\u4E3A ", bold: false },
        { text: "162 \u2014 165 \u4EBF\u5143", bold: true, color: "2E75B6" },
        { text: "\uFF0C\u8F83\u5E74\u521D\u6307\u5F15\u4E0A\u8C03 ", bold: false },
        { text: "8%", bold: true, color: "00B050" },
        { text: "\uFF0C\u663E\u793A\u7BA1\u7406\u5C42\u5BF9\u672A\u6765\u589E\u957F\u4FE1\u5FC3\u5145\u8DB3\u3002", bold: false }
      ], { after: 120 }),

      // Guidance summary table
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "5.4 \u6307\u5F15\u6C47\u603B\u8868", font: "Arial" })] }),
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [3120, 3120, 3120],
        rows: [
          new TableRow({
            children: [
              makeHeaderCell("\u6307\u5F15\u9879\u76EE", { cellWidth: 3120 }),
              makeHeaderCell("\u6307\u5F15\u8303\u56F4", { cellWidth: 3120 }),
              makeHeaderCell("\u5907\u6CE8", { cellWidth: 3120 }),
            ]
          }),
          new TableRow({
            children: [
              makeCell("Q4 \u8425\u6536", { bold: true }),
              makeCell("45.0 \u2014 47.5 \u4EBF\u5143", { align: AlignmentType.CENTER, bold: true }),
              makeCell("\u540C\u6BD4\u589E\u9579 19% \u2014 26%", { align: AlignmentType.CENTER }),
            ]
          }),
          new TableRow({
            children: [
              makeCell("Q4 \u51C0\u5229\u6DA6", { bold: true }),
              makeCell("6.5 \u2014 7.2 \u4EBF\u5143", { align: AlignmentType.CENTER, bold: true }),
              makeCell("\u7EE7\u7EED\u4FDD\u6301\u76C8\u5229\u80FD\u529B", { align: AlignmentType.CENTER }),
            ]
          }),
          new TableRow({
            children: [
              makeCell("\u5168\u5E74\u6536\u5165", { bold: true }),
              makeCell("162 \u2014 165 \u4EBF\u5143", { align: AlignmentType.CENTER, bold: true }),
              makeCell("\u8F83\u5E74\u521D\u6307\u5F15\u4E0A\u8C03 8%", { align: AlignmentType.CENTER, bold: true, fontSize: 18, color: "00B050" }),
            ]
          }),
        ]
      }),

      sectionBreak(),

      // ==================== PAGE 7: KEY TRENDS & CONCLUSIONS ====================
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: "\u516D\u3001\u5173\u952E\u8D8B\u52BF\u4E0E\u7ED3\u8BBA", font: "Arial" })] }),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "6.1 \u79EF\u6781\u8D8B\u52BF", font: "Arial" })] }),
      makeBullet("\u8425\u6536\u8FDE\u7EED\u589E\u957F\uFF0CQ3 \u540C\u6BD4\u589E\u901F 23.4%\uFF0C\u8D85\u51FA\u5E02\u573A\u9884\u671F"),
      makeBullet("\u4E91\u8BA1\u7B97\u4E1A\u52A1\u9996\u6B21\u6210\u4E3A\u6700\u5927\u6536\u5165\u6765\u6E90\uFF08\u5360\u6BD4 49.9%\uFF09\uFF0C\u5E74\u5316\u8425\u6536\u7A81\u7834\u767E\u4EBF"),
      makeBullet("AI \u4E1A\u52A1\u7206\u53D1\u5F0F\u589E\u957F\uFF08\u540C\u6BD4 +187%\uFF09\uFF0C\u6210\u4E3A\u7B2C\u4E8C\u589E\u957F\u66F2\u7EBF"),
      makeBullet("\u76C8\u5229\u80FD\u529B\u6301\u7EED\u6539\u5584\uFF1A\u6BDB\u5229\u7387\u540C\u6BD4\u63D0\u5347 1.9pp\uFF0C\u51C0\u5229\u7387\u540C\u6BD4\u63D0\u5347 0.9pp"),
      makeBullet("\u7ECF\u8425\u73B0\u91D1\u6D41\u5F3A\u52B2\u589E\u9579 30.6%"),
      makeBullet("\u4F01\u4E1A\u5BA2\u6237\u6570\u6301\u7EED\u6269\u5F20\uFF08\u51C0\u589E 1,203 \u5BB6\uFF09"),
      makeBullet("\u6D77\u5916\u5E02\u573A\u5FEB\u901F\u62D3\u5C55\uFF0C\u4E1C\u5357\u4E9A\u589E\u901F\u8FBE 67%"),
      makeBullet("\u5168\u5E74\u6536\u5165\u6307\u5F15\u4E0A\u8C03 8%"),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "6.2 \u98CE\u9669\u5173\u6CE8", font: "Arial" })] }),
      makeBullet("\u5B8F\u89C2\u7ECF\u6D4E\u538B\u529B\u53EF\u80FD\u5F71\u54CD Q4 \u6536\u5165\u7EA6 1.5 \u4EBF\u5143"),
      makeBullet("AI \u8D5B\u9053\u7ADE\u4E89\u52A0\u5267\uFF0CAPI \u5355\u4EF7\u4E0B\u964D\u538B\u529B\u53EF\u80FD\u538B\u7F29\u6BDB\u5229\u7387 1-2pp"),
      makeBullet("\u4EBA\u529B\u6210\u672C\u5FEB\u901F\u4E0A\u5347\uFF08\u540C\u6BD4 +38%\uFF09"),
      makeBullet("\u6D77\u5916\u5408\u89C4\u6210\u672C\u589E\u52A0\uFF08\u7EA6 0.8 \u4EBF\u5143\uFF09"),

      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: "6.3 \u603B\u4F53\u8BC4\u4F30", font: "Arial" })] }),
      makeMultiRunPara([
        { text: "\u661F\u4E91\u79D1\u6280 Q3 2025 \u4E1A\u7EE9\u8868\u73B0\u5F3A\u52B2\uFF0C\u8425\u6536\u548C\u5229\u6DA6\u5747\u5B9E\u73B0\u53CC\u4F4D\u6570\u589E\u957F\uFF0C\u4E91\u8BA1\u7B97\u548C AI \u4E1A\u52A1\u6210\u4E3A\u6838\u5FC3\u589E\u957F\u5F15\u64CE\u3002\u516C\u53F8\u4E0A\u8C03\u5168\u5E74\u6536\u5165\u6307\u5F15\uFF0C\u663E\u793A\u7BA1\u7406\u5C42\u5BF9\u672A\u6765\u589E\u957F\u4FE1\u5FC3\u5145\u8DB3\u3002", size: 22 }
      ], { after: 120 }),

      // Final separator
      new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [] }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: "2E75B6", space: 1 } },
        spacing: { before: 200, after: 200 },
        children: [new TextRun({ text: "\u2014 \u62A5\u544A\u7ED3\u675F \u2014", font: "Arial", size: 20, color: "808080", bold: true })]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("/workspace/output/quarterly_report_q3_2025.docx", buffer);
  console.log("Document generated successfully!");
}).catch(err => {
  console.error("Error generating document:", err);
  process.exit(1);
});
