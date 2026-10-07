function get_publications(){
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet_name  = "publications";
  var sheet  = spreadsheet.getSheetByName(sheet_name);
  var psheet = spreadsheet.getSheetByName("item list");
  var range  = sheet.getDataRange(); 
  var values = range.getValues();
  var richValues = range.getRichTextValues();
  var psheet  = spreadsheet.getSheetByName("item list");
  var prange  = psheet.getDataRange();
  var pvalues = prange.getValues(); 
  
  jtList = [];

  var journal_replace_dict = {};
  for (var i=1; i<pvalues.length; i++){
    journal_replace_dict[pvalues[i][8]] = pvalues[i][9];
  }

  return journal_replace_dict;
  /*if(INDEPENDENTS.includes(sheet_name)){
    for (var i=1; i<values.length; i++){
      if(values[i][2] === "Publication" && values[i][3].startsWith("/*") === false){
        var pmid = values[i][3];
        var url  = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/?format=pubmed`;
        var bibdict = pmid_bibdict(url);
        console.log(url, bibdict["JT"]);
        if(jtList.includes(bibdict["JT"])===false){
          jtList.push(bibdict["JT"]);
        }
      }
    }
  }
  */
}