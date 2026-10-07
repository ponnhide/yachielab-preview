function getTextColors() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("blank");
  var range = sheet.getRange("A1");
  var richText = range.getRichTextValue();
  var runs = richText.getRuns();

  runs.forEach(function(run, index) {
    var text = run.getText();
    console.log(text);
    var textStyle = run.getTextStyle();
    var foregroundColor = textStyle.getForegroundColorObject().asRgbColor().asHexString();
    console.log(textStyle.isBold())
    console.log(textStyle.isItalic()) 
    console.log("テキスト: " + text + ", 色: " + foregroundColor);
  });
}

function convertMarkdownToHtml(markdownText) {
  // Showdown コンバーターを使用
  var converter = new showdown.Converter();
  var html = converter.makeHtml('If you are interested in our open position, please see [here](../joinus.html) first.');
  console.log(html);
}