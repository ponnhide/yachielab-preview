function update_ppl(sheet_name, file_path) {
  if (sheet_name==="People_Osaka"){
    var target_id = "prime-content";
  } else {
    var target_id = "ubc-content";
  }
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(sheet_name)
  
  //var sheet = spreadsheet.getSheets()[0];
  var range = sheet.getDataRange(); 
  var values = range.getValues();
  
  // GitHubから現在のファイルの内容を取得
  var githubFile = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, file_path, BRANCH);
  var encodedContent = githubFile.content;
  var sha = githubFile.sha;

  // Base64でデコードしてHTMLを更新
  var decodedContent = Utilities.newBlob(Utilities.base64Decode(encodedContent)).getDataAsString();
  const $ = Cheerio.load(decodedContent);
  
  var num_dict = {"PI":[0,"Principal Investigator"], 
                  "PD":[0,"Postdoctoral Researchers"],
                  "PS":[0,"Ph.D. Students"],
                  "MS":[0,"Master's Students"],
                  "US":[0,"Undergraduate Students"],
                  "ST":[0,"Staff Members"]}
  $(`#${target_id}`).empty();
  $(`#${target_id}`).append('<section class="position PI"></section>')
  $(`#${target_id}`).append('<section class="position PD"></section>')
  $(`#${target_id}`).append('<section class="position PS"></section>')
  $(`#${target_id}`).append('<section class="position MS"></section>')
  $(`#${target_id}`).append('<section class="position US"></section>')
  $(`#${target_id}`).append('<section class="position ST"></section>')

  for (var i = 1; i < values.length; i++) { 
    var row = values[i];
    var id  = row[0];       
    var pos = row[1];
    if (num_dict[pos][0] == 0){
      var content = `<h2>${num_dict[pos][1]}</h2>`;
      $(`#${target_id} .${pos}`).append(content);
      num_dict[pos][0] += 1;
    }else{
      //
    }
  }  

  for (var i = 1; i < values.length; i++) { 
    var row = values[i];  
    var id    = row[0];       
    var pos   = row[1]; 
    var dpos  = row[2];
    var name  = row[3]; 
    var link  = row[4];
    var photo = row[5].replace("file/d/","uc?export=download&id=").replace("/view?usp=drive_link","");
    var intro = row[6];
    var attributes = row[7].split("\n");

    var content = `<section class="member" id="${id}">\n`;
    content += '<div class="personal_photo">\n';
    if (photo === "" || photo === undefined) {
      content += `<div class="noimage"></div>\n`;
    }else{
      content += `<img class="personal_img" src=${photo} alt={name}>\n`;
    }
    content += '</div>\n';
    
    content += '<div class="personal_info">\n';
    if (link === "" || link === undefined) {
      content += `<p class="name">${name}</p>\n`;
    }else{
      content += `<p class="name"><a href=${link}>${name}</a>\n`;
    }
    content += `<p class="dpos">${dpos}</p>\n`;
    content += `<p class="intro">${intro}</p>\n`;

    for (var j=0; j < attributes.length; j++){
      item = attributes[j].split(": ");
      if (item.length === 1 & item[0] === ""){
        //
      }else{
        if (item.lengh === 1){
          content += `<p class="attribute"><span class="key">${item[0]}</span></p>\n`;
        }else if(item.length === 2){
          content += `<p class="attribute"><span class="key">${item[0]}: </span><span class="value">${item[1]}</span></p>\n`;
        }else{
          //
        }
      }
    }

    content += '</div>\n';

    content += '</section>\n';
    console.log(content);
    $(`#${target_id} .${pos}`).append(content);
  }
  newContent = '<html>' + $('html').html() + '</html>';
  var updatedContent = Utilities.base64Encode(newContent);
  // GitHubにファイルを更新してプッシュ
  pushToGitHub(GITHUB_TOKEN, REPO_NAME, file_path, BRANCH, updatedContent, sha);
}

function update_ppl_Osaka(){
  update_ppl("People_Osaka", '11d209ee7c82a8920707692b16b3f4188ea2c8809ca57537edc96ff6c699761c/html/people.html');
}

function update_ppl_UBC(){
  update_ppl("People_UBC", '11d209ee7c82a8920707692b16b3f4188ea2c8809ca57537edc96ff6c699761c/html/people.html');
}

//function onEdit(e) {
//  var range = e.range; 
//  var sheet = range.getSheet();
//  var sheet_name = sheet.name;
//  var sheet_names = ["people", "publications", "research", "joinus", "news", "contact"];
//  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
//
//  if (sheet_names.includes(sheet_name)){
//    var editedColumn = range.getColumn(); 
//    var specificColumn = 3;
//    if (editedColumn === specificColumn) {
//      changeFontColor(spreadsheet, sheet_name);
//    }
//  }
//}