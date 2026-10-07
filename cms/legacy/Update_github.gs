//const ROOT = "11d209ee7c82a8920707692b16b3f4188ea2c8809ca57537edc96ff6c699761c/"
const ROOT = "";
const GITHUB_TOKEN = PropertiesService.getScriptProperties().getProperty('PREVIEW_GITHUB_TOKEN') || '';
//const REPO_NAME  = 'ponnhide/Yachielab_web';
const REPO_NAME    = 'ponnhide/yachielab-preview';
const IMG_PATH     = `${ROOT}img`
const PDF_PATH     = `${ROOT}pdf`
//const FILE_PATH  = '11d209ee7c82a8920707692b16b3f4188ea2c8809ca57537edc96ff6c699761c/html/ppl_Osaka.html';
const BRANCH       = 'codex/preview';
const MEMBERS      = getMembers();
const INDEPENDENTS = getIndependentPages();
const MDLINKREG    = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
var PubRepDict = null;
var PreElement  = "";
var PostElement = "";

function addNewpage(){
  var headers = {
    "Authorization": "token " + GITHUB_TOKEN,
    "Accept": "application/vnd.github.v3+json"
  };

  var options = {
    "method": "get",
    "headers": headers,
    "muteHttpExceptions": true 
  };

  for (var i=0; i<INDEPENDENTS.length; i++){
    var filePath = `${ROOT}${INDEPENDENTS[i]}.html`;
    var url = 'https://api.github.com/repos/' + REPO_NAME + '/contents/' + filePath; 
    var response = previewFetch_(url, options);
    var status = response.getResponseCode();
    if (status === 404){
      //console.log([status, INDEPENDENTS[i]]);
      var blankFilePath  = `${ROOT}blank.html`
      var blankFile      = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, blankFilePath, BRANCH);
      var encodedContent = blankFile.content;
      uploadGitHub(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH, encodedContent);
    } else {
      null;
      //console.log(INDEPENDENTS[i] + " PASS");
    }
  }
}

function update_test(){
  var headers = {
    "Authorization": "token " + GITHUB_TOKEN,
    "Accept": "application/vnd.github.v3+json"
  };

  var options = {
    "method": "get",
    "headers": headers,
    "muteHttpExceptions": true 
  };

  for (var i=0; i<INDEPENDENTS.length; i++){
    var filePath = `${ROOT}${INDEPENDENTS[i]}.html`;
    var url = 'https://api.github.com/repos/' + REPO_NAME + '/contents/' + filePath; 
    var response = previewFetch_(url, options);
    var status = response.getResponseCode();
    if (status === 404){
      //console.log([status, INDEPENDENTS[i]]);
      var blankFilePath  = `${ROOT}blank.html`
      var blankFile      = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, blankFilePath, BRANCH);
      var encodedContent = blankFile.content;
      uploadGitHub(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH, encodedContent);
    } else {
      //console.log(INDEPENDENTS[i] + " PASS");
    }
  }
}

function getIndependentPages() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var item_sheet = spreadsheet.getSheetByName("item list");
  var range  = item_sheet.getDataRange(); 
  var values = range.getValues();
  var sheet_names = [] 
  for (var i=1; i<values.length; i++){
    if(values[i][4] !== ""){ 
      sheet_names.push(values[i][4]);
    }
  }
  return sheet_names
}

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  // カスタムメニュー項目を追加する
  var menu = ui.createMenu('Custom menu')
  menu.addItem('Update the current page', 'update_webpage').addToUi();
  menu.addItem('Add a new page', 'makeNewpage').addToUi();
  
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var item_sheet = spreadsheet.getSheetByName("item list");
  var range  = item_sheet.getDataRange(); 
  var values = range.getValues();
  var sheet_names = [] 
  for (var i=1; i<values.length; i++){
    sheet_names.push(values[i][3])
  }
  for (var i=0; i<sheet_names.length; i++){
    //console.log(sheet_names[i]);
    changeFontColor(spreadsheet, sheet_names[i]);
  } 
}

/*function changeFontColor(spreadsheet, sheet_name){
  var sheet = spreadsheet.getSheetByName(sheet_name);
  var range  = sheet.getDataRange();
  var values = range.getValues();
  for (var j = 0; j < values.length; j++) {
    for (var k = 0; k < values[j].length; k++) {
      var cellValue = values[j][k];
      if (typeof cellValue === 'string' && cellValue.startsWith('/* ')) {
        sheet.getRange(j + 1, k + 1).setFontColor('#BBBBBB');
      }
    }
  } 
}*/

function changeFontColor(spreadsheet, sheet_name){
  var sheet = spreadsheet.getSheetByName(sheet_name);
  var range = sheet.getDataRange();

  var values = range.getValues();
  var fontColors = range.getFontColors();

  for (var j = 0; j < values.length; j++) {
    for (var k = 0; k < values[j].length; k++) {
      var cellValue = values[j][k];

      if (typeof cellValue === 'string' && cellValue.startsWith('/* ')) {
        fontColors[j][k] = '#BBBBBB';
      } else if (
        fontColors[j][k] &&
        fontColors[j][k].toUpperCase() === '#BBBBBB'
      ) {
        fontColors[j][k] = '#000000';
      }
    }
  }

  range.setFontColors(fontColors);
}

function getGithubFileContent(token, repo, path, branch) {
  var url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${branch}`;
  //var url = "https://api.github.com/repos/yachielab/yachielab.github.io/contents/jikkenigaku.html?ref=main";
  //console.log(url);
  var options = {
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json'
    },
    'method': 'get'
  };
  //console.log(url);
  var response = previewFetch_(url, options);
  var json = JSON.parse(response.getContentText());
  return json;
}

function pushToGitHub(token, repo, path, branch, content, sha) {
  if(path.startsWith("/")){
    path = path.slice(1);
  }
  var url = `https://api.github.com/repos/${repo}/contents/${path}`;
  var payload = JSON.stringify({
    'message': 'Updating HTML content via Google Apps Script',
    'content': content,
    'sha': sha,
    'branch': branch
  });

  var options = {
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json'
    },
    'method': 'put',
    'payload': payload,
    'muteHttpExceptions': true 
  };

  var response = previewFetch_(url, options);
  //console.log(path,JSON.parse(response.getContentText()));
  return true;
}

function uploadGitHub(token, repo, path, branch, content) {
  if(path.startsWith("/")){
    path = path.slice(1);
  }
  var url = `https://api.github.com/repos/${repo}/contents/${path}`;
  var payload = JSON.stringify({
    'message': 'Updating HTML content via Google Apps Script',
    'content': content,
    'branch': branch
  });

  var options = {
    headers: {
      'Authorization': 'token ' + token,
      'Accept': 'application/vnd.github.v3+json'
    },
    'method': 'put',
    'payload': payload,
    'muteHttpExceptions': true 
  };
  var response = previewFetch_(url, options);
  //return JSON.parse(response.getContentText());
  return true;
}

function uploadImg(imgLink){ 
  //var imgLink = "https://www.dropbox.com/scl/fi/5c8voebti6nvr606avovj/navy_yachielablogo2.svg?rlkey=299iupfp70xy57njj9b977z6q&dl=0";
  //var imgLink = "https://drive.google.com/file/d/1vPzRIp8EeXd9C9NQRw3FpdcrmejmoCzm/view?usp=drive_link"
  if (imgLink.includes("drive.google.com") === true){
    var match   = imgLink.match(/\/file\/d\/([a-zA-Z0-9_-]+)/); 
    var imgFile  = DriveApp.getFileById(match[1]);
    var fileName = imgFile.getName();
    if (fileName.endsWith(".pdf") === true){ 
      var filePath = PDF_PATH + "/" + fileName;
      var returnPATH = "./pdf/" + fileName; 
    } else { 
      var filePath = IMG_PATH + "/" + fileName;
      var returnPATH = "./img/" + fileName; 
    }    
    var url = 'https://api.github.com/repos/' + REPO_NAME + '/contents/' + filePath;
    imgLink = imgLink.replace("file/d/","uc?export=download&id=").replace("/view?usp=drive_link","");
  } else if (imgLink.includes("www.dropbox.com") === true){
    var match = imgLink.match(/([^\/]+)\?/);
    var fileName = match[1];
    if (fileName.endsWith(".pdf") === true){ 
      var filePath = PDF_PATH + "/" + fileName;
      var returnPATH = "./pdf/" + fileName; 
    } else { 
      var filePath = IMG_PATH + "/" + fileName;
      var returnPATH = "./img/" + fileName; 
    } 
    var url = 'https://api.github.com/repos/' + REPO_NAME + '/contents/' + filePath;
    imgLink = imgLink.replace("dl=0","dl=1");
  } else if (imgLink.endsWith(".pdf") || imgLink.endsWith(".jpeg") || imgLink.endsWith(".svg") || imgLink.endsWith(".png")){
    var names = imgLink.split("/");
    var fileName = names[names.length-1];
    if (fileName.endsWith(".pdf") === true){ 
      var filePath = PDF_PATH + "/" + fileName;
      var returnPATH = "./pdf/" + fileName; 
    } else {
      var filePath = IMG_PATH + "/" + fileName;
      var returnPATH = "./img/" + fileName; 
    } 
    var url = 'https://api.github.com/repos/' + REPO_NAME + '/contents/' + filePath;
  } else {
    return "";
  }

  var headers = {
    "Authorization": "token " + GITHUB_TOKEN,
    "Accept": "application/vnd.github.v3+json"
  };

  var gitoptions = {
    "method": "get",
    "headers": headers,
    "muteHttpExceptions": true 
  };

  //console.log(url);
  var gitResponse = previewFetch_(url, gitoptions);
  var status = gitResponse.getResponseCode();
  console.log(url, status);

  if (status === 404){
    //console.log(status, imgLink, url);
    var response = previewFetch_(imgLink);
    if (fileName.endsWith(".svg") === true || fileName.endsWith(".txt") === true){
      var content = response.getContentText();
      var encodedContent = Utilities.base64Encode(content);
    } else {
      var blob = response.getBlob();
      var encodedContent = Utilities.base64Encode(blob.getBytes());
    }
    uploadGitHub(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH, encodedContent);
  } else {
    //console.log(status, imgLink, url);
    if(fileName.endsWith(".pdf") === false){      
      console.log("img");
      //var response = previewFetch_(imgLink);
      //if (fileName.endsWith(".svg") === true || fileName.endsWith(".txt") === true){
      //  var content = response.getContentText();
      //  var encodedContent = Utilities.base64Encode(content);
      //} else {
      //  var blob = response.getBlob();
      //  var encodedContent = Utilities.base64Encode(blob.getBytes());
      //}
      //var githubFile = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH);
      //var sha = githubFile.sha;
      //pushToGitHub(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH, encodedContent, sha);
    } else {
      console.log("pdf");
      //Pass
    }
  }
  return returnPATH;
}

function update_webpage(){
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet  = spreadsheet.getActiveSheet();
  var sheet_name = sheet.getName();
  
  //var sheet_name = "footer";
  //var sheet = spreadsheet.getSheetByName(sheet_name);
  
  var range  = sheet.getDataRange(); 
  var values = range.getValues();
  console.log(values.length);
  //console.log(hogehogehoge);
  var richValues = range.getRichTextValues();
  
  PubRepDict = get_publications();
  
  if(INDEPENDENTS.includes(sheet_name)){
    var filePath  = `${ROOT}${sheet_name}.html`
    var githubFile = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH);
    var encodedContent = githubFile.content;
    var sha = githubFile.sha;
    var decodedContent = Utilities.newBlob(Utilities.base64Decode(encodedContent)).getDataAsString();
    let $ = Cheerio.load(decodedContent);
    $(`.posts`).empty();
    var allContent = "";
    console.log(sheet_name)
    for (var i=1; i<values.length; i++){
      if (values[i][0] === "") {
        break;
      }
      console.log(i)
      if (i>1) {
        PreElement = values[i-1];
      } else {
        PreElement = "START";
      }
      
      if (i-1==values.length-2) {
        PostElement = "END";
      } else {
        PostElement = values[i+1];
      }
      console.log(values[i], richValues[i]);
      allContent = allContent + appendSingle(values[i], richValues[i]);
    }
    $(`.posts`).append(allContent);
    newContent = '<html>\n' + $('html').html() + '</html>';
    //console.log($('.posts').html());
    //var file = DriveApp.createFile(`${sheet_name}_test.html`, newContent);
    //console.log(file.getId());
    var textBlob = Utilities.newBlob(newContent, 'text/plain', 'UTF-8');
    var updatedContent = Utilities.base64Encode(textBlob.getBytes());
    //console.log("UPDATE",filePath);
    pushToGitHub(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH, updatedContent, sha);
  } else {
    if (sheet_name === "header"){
      target = "#normal_header";
    } else if (sheet_name === "footer"){
      target = "footer";
    } else if (sheet_name === "sidebar"){
      target = "aside";
    } else if (sheet_name === "mobilemenu"){
      target = "#mobile-menu";
    }
    var allContent = "";
    for (var j=1; j<values.length; j++){
      allContent = allContent + appendSingle(values[j], richValues[j]);
    }
    var independents_index = INDEPENDENTS.concat("index"); 
    for (var i=0; i<independents_index.length; i++){
      var html_name  = independents_index[i];
      var filePath   = `${ROOT}${html_name}.html`
      var githubFile = getGithubFileContent(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH);
      var encodedContent = githubFile.content;
      var sha = githubFile.sha;
      var decodedContent = Utilities.newBlob(Utilities.base64Decode(encodedContent)).getDataAsString();
      let $ = Cheerio.load(decodedContent);
      $(target).empty();
      $(target).append(allContent);
      //console.log(html_name);
      newContent = '<html>\n' + $('html').html() + '</html>';
      //console.log(hogehogehoge);
      var textBlob = Utilities.newBlob(newContent, 'text/plain', 'UTF-8');
      var updatedContent = Utilities.base64Encode(textBlob.getBytes());
      pushToGitHub(GITHUB_TOKEN, REPO_NAME, filePath, BRANCH, updatedContent, sha);
    }
  }
}

function appendSingle(row, richrow){
  var spreadsheet  = SpreadsheetApp.getActiveSpreadsheet();
  var parameter_sheet = spreadsheet.getSheetByName("parameters");
  var data = parameter_sheet.getDataRange().getValues();
  var parameter_dict = {};
  for (var i = 1; i < data.length; i++) {
    var key    = data[i][0];
    var values = data[i].slice(1);
    for (var j = 0; j < values.length; j++){
      values[j] = values[j].replace(/ \(.+\)/, "");
    }
    parameter_dict[key] = ["Lab", "Language", "Function"].concat(values);
  }
  
  var adict  = {};
  var header = parameter_dict[row[2]];
  
  //console.log(header);
  if((row[2] in parameter_dict) === false){
    return "";
  }

  for (var i = 0; i < header.length; i++) {
    if((header[i] === "/* Text" || header[i] === "/* Name" || header[i] === "/* Related info" || header[i] === "/* Biosketch" || header[i] === "/* Former affiliation" || header[i] === "/* Start date" || header[i] === "/* End date" || header[i] === "/* Current position") && (row[i].startsWith("/*")===false)){
      var runs = richrow[i].getRuns();
      runs.forEach(function(run) {
        var text     = run.getText();
        var endspace = ""; 
        
        while(text.endsWith(" ")===true){
          text = text.substr(0,text.length-1);
          endspace = endspace + " ";
        }

        var newText = text;
        var textStyle = run.getTextStyle();
        //console.log(textStyle);
        var foregroundColor = textStyle.getForegroundColorObject().asRgbColor().asHexString();
        var bold   = textStyle.isBold(); 
        var italic = textStyle.isItalic();
        if(foregroundColor !== "#000000"){
          newText = `<span style="color:${foregroundColor}">${text}</span>`;
        }
        if(bold){
          newText = "**" + newText + "**";
        }
        if(italic){
          newText = "*" + newText + "*";
        }
        row[i] = row[i].replace(text + endspace, newText + endspace);
      });
      
      row[i] = row[i].replace("\\@\\",'<img src="./img/at.gif" style="vertical-align: middle; height: 1em;" alt="[at]">')
      adict[header[i]] = row[i];
    }else{
      adict[header[i]] = row[i];
    }
  }

  if (row[2] === "H1"){
    return appendH1(adict);
  }else if (row[2] === "H2"){
    return appendH2(adict);
  }else if (row[2] === "H3"){
    return appendH3(adict);
  }else if (row[2] === "Member"){
    return appendMember(adict);
  }else if (row[2] === "Content"){
    return appendContent(adict);
  }else if (row[2] === "Publication"){ 
    return appendPublication(adict);
  }else if (row[2] === "Publication (custom)"){
    //console.log(row, parameter_dict["Publication (custom)"]);
    return appendCustomPublication(adict);
  }else if (row[2] === "Post"){
    return appendPost(adict);
  }else if (row[2] === "News"){
    return appendNews(adict);
  }else if (row[2] === "div"){
    return appendDivStart(adict)
  } else if (row[2] === "/div"){
    return appendDivEnd()
  } else if (row[2] === "Alumni"){
    return appendAlumni(adict);
  } else {
    return "";
  }
}

function appendH(adict, hlevel){
  var style = "";
  if (adict["/* Style"].startsWith("/*") === false){
    style = style + adict["/* Style"];
  }

  var affil = adict["Lab"];
  var lang  = adict["Language"].replace(/,/g,"");
  var title = (adict["/* Title"].startsWith("/*") === false) ? adict["/* Title"]: ""; 
  var id = (adict["/* ID"].startsWith("/*") === false) ? adict["/* ID"]: "";

  if (style === ""){
    var content = `<h${hlevel} class="page_title ${affil} ${lang}"`;
  }else{
    var content = `<h${hlevel} class="page_title ${affil} ${lang}" style="${style}"`;
  }
  if (id !== ""){
    content = content + ` id="${id}">${title}</h${hlevel}>`;
  } else {
    content = content + `>${title}</h${hlevel}>`;
  }
  return content;
}

function appendH1(adict){
  return appendH(adict, "1");
}

function appendH2(adict){
  return appendH(adict, "2");
}

function appendH3(adict){
  return appendH(adict, "3");
}

function appendAlumni(adict){
  var converter = new showdown.Converter();

  //console.log(adict);
  var affil   = adict["Lab"];
  var lang    = adict["Language"].replace(/,/g,"");       
  var fpos    = converter.makeHtml((adict["/* Former affiliation"].startsWith("/*") === false) ? adict["/* Former affiliation"] : "");
  var cpos    = converter.makeHtml((adict["/* Current position"].startsWith("/*") === false) ? adict["/* Current position"] : "");
  var name    = converter.makeHtml(adict["/* Name"]);
  var pname   = adict["/* Name in publication"].split(",")[0];
  var sdate   = converter.makeHtml((adict["/* Start date"].startsWith("/*") === false) ? adict["/* Start date"] : "");
  var edate   = converter.makeHtml((adict["/* End date"].startsWith("/*") === false) ? adict["/* End date"] : "");
  var personal_links = (adict["/* Personal links"].startsWith("/*") === false) ? adict["/* Personal links"] : "";
  var photo   = (adict["/* Photo url"].startsWith("/*") === false) ? uploadImg(adict["/* Photo url"]) : "";
  var filter  = (adict["/* insta filter"].startsWith("/*") === false) ? adict["/* insta filter"] : "";
  if(personal_links !== ""){
    name = `${name} (${personal_links})`;
  } else {
    name = name;
  }
  
  var style = "";
  if (adict["/* Margin top"].startsWith("/*") === false){
    style = style + `margin-top: ${adict["/* Margin top"]};`
  }
  
  if (adict["/* Margin bottom"].startsWith("/*") === false){
    style = style + `margin-bottom: ${adict["/* Margin bottom"]};`
  }

  console.log(`hoge ${PreElement}`);
  if (PreElement[2] === "H1"){
    if(style === ""){
      var content = `<section class="grid-container alumni ${affil} ${lang}">\n`;
    }else{
      var content = `<section class="grid-container alumni ${affil} ${lang}" style="${style}">\n`;
    }
    content += `<div class="subtitle grid-item grid-row"></div>\n`;
    content += `<div class="subtitle grid-item grid-row">${name}</div>\n`;
    content += `<div class="subtitle grid-item grid-row">${fpos}</div>\n`;
    content += `<div class="subtitle grid-item grid-row">${cpos}</div>\n`;
    content += `<div class="subtitle grid-item grid-row">${sdate}</div>\n`;
    content += `<div class="subtitle grid-item grid-row">${edate}</div>\n`;
  } else if (adict["/* Name"].includes("**")){
    var content = "";
    content += `<div class="subtitle grid-item grid-row">${name}</div>\n`;
    content += `<div class="subtitle grid-item grid-row"></div>\n`;
    content += `<div class="subtitle grid-item grid-row">${fpos}</div>\n`;
    content += `<div class="subtitle grid-item grid-row">${cpos}</div>\n`;
    content += `<div class="subtitle grid-item grid-row">${sdate}</div>\n`;
    content += `<div class="subtitle grid-item grid-row">${edate}</div>\n`;
  } else {
    var content = "";
    if(filter === ""){
      content += '<div class="grid-item grid-row personal_photo">\n';
    }else{
      content += `<div class="grid-item grid-row personal_photo ${filter}">\n`;
    }
    if (photo === "" || photo === undefined) {
      content += `<div class="noimage"></div>\n`;
    }else{
      content += `<img class="personal_img" src=${photo} alt="${pname}">\n`;
    }
    content += '</div>\n';
    content += `<div class="grid-item grid-row">${name}</div>\n`;
    content += `<div class="grid-item grid-row">${fpos}</div>\n`;
    content += `<div class="grid-item grid-row">${cpos}</div>\n`;
    content += `<div class="grid-item grid-row">${sdate}</div>\n`;
    content += `<div class="grid-item grid-row">${edate}</div>\n`;
  }
    
  if (PostElement[2] === ""){
    content += `</section>`;
  } else if (PostElement === "END"){
    null; 
  } else {
    null; 
  }
  //content += '</section>\n';
  //console.log(content);
  return content;
}

function appendMember(adict){
  //console.log(adict);
  var affil   = adict["Lab"];
  var lang    = adict["Language"].replace(/,/g,"");       
  var dpos    = adict["/* Position"];
  var name    = adict["/* Name"];
  var personal_links = (adict["/* Personal links"].startsWith("/*") === false) ? adict["/* Personal links"] : "";
  if(personal_links !== ""){
    name = `${name} (${personal_links})`;
  } else {
    name = name;
  }

  var pname   = adict["/* Name in publication"].split(",")[0];
  var photo   = (adict["/* Photo url"].startsWith("/*") === false) ? uploadImg(adict["/* Photo url"]) : "";
  var project = adict["/* Project"];
  var hobby   = adict["/* Hobby or fun fact"];
  var twitter = adict["/* Twitter"]; 
  var email   = adict["/* E-mail"];
  var filter  = (adict["/* insta filter"].startsWith("/*") === false) ? adict["/* insta filter"] : "";
  email = email.replace("@", '<img src="./img/at.gif" style="vertical-align: middle; height: 1em;" alt="[at]">');
  var intro   = (adict["/* Biosketch"].startsWith("/*") === false) ? adict["/* Biosketch"] : "";
  var attributes = adict["/* Others"].split("\n");
  
  var style = "";
  if (adict["/* Margin top"].startsWith("/*") === false){
    style = style + `margin-top: ${adict["/* Margin top"]};`
  }
  
  if (adict["/* Margin bottom"].startsWith("/*") === false){
    style = style + `margin-bottom: ${adict["/* Margin bottom"]};`
  }

  if(style === ""){
    var content = `<section class="member ${affil} ${lang}">\n`;
  }else{
    var content = `<section class="member ${affil} ${lang}" style="${style}">\n`;
  }

  if(filter === ""){
    content += '<div class="personal_photo">\n';
  }else{
    content += `<div class="personal_photo ${filter}">\n`;
  }
  if (photo === "" || photo === undefined) {
    content += `<div class="noimage"></div>\n`;
  }else{
    content += `<img class="personal_img" src=${photo} alt="${pname}">\n`;
  }
  content += '</div>\n';
  content += '<div class="personal_info">\n';
  var converter = new showdown.Converter();

  let match;
  let matches = [];
  while ((match = MDLINKREG.exec(name)) !== null) { 
      if (match[2].includes("www.dropbox.com")) {
        matches.push(match[2]); 
      }
  }
  for (var i=0; i<matches.length; i++){
    var newlink = uploadImg(matches[i]);
    name = name.replace(matches[i], newlink);
  }

  mname = converter.makeHtml(name);
  mname = mname.replace("<p>",'<p class="name">')
  content += mname + '\n';
  
  content += `<p class="dpos">${dpos}</p>\n`;
  content += `<p class="intro">${intro}</p>\n`;
  
  if (project.startsWith("/* ") === false){
    content += `<p class="attribute"><span class="key">Project: </span><span class="value">${project}</span></p>\n`;
  } 

  if (twitter.startsWith("/* ") === false){
    content += `<p class="attribute"><span class="key">X: </span><span class="value"><a href="https://twitter.com/${twitter}">${twitter}</a></span></p>\n`;
  } 

  if (email.startsWith("/* ") === false){
    content += `<p class="attribute"><span class="key">E-mail: </span><span class="value">${email}</span></p>\n`;
  }

  if (hobby.startsWith("/* ") === false){
    content += `<p class="attribute"><span class="key">Hobby or fun fact: </span><span class="value">${hobby}</span></p>\n`;
  } 

  for (var j=0; j < attributes.length; j++){
    var item = attributes[j].split(": ");
    if (item.length === 1 & item[0] === ""){
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
  //console.log(content);
  return content;
}

function appendContent(adict){
  var affil     = adict["Lab"];
  var lang      = adict["Language"].replace(/,/g,"");
  var text      = (adict["/* Text"].startsWith("/*") === false && adict["/* Text"].startsWith("/*") !== "") ? adict["/* Text"]: "";
  var img_link  = (adict["/* img url"].startsWith("/*") === false && adict["/* img url"].startsWith("/*") !== "") ? uploadImg(adict["/* img url"]): "";
  var filter    = (adict["/* insta filter"].startsWith("/*") === false) ? adict["/* insta filter"] : "";
  var hyperlink = (adict["/* img hyperlink"].startsWith("/*") === false && adict["/* img url"].startsWith("/*") !== "") ? adict["/* img hyperlink"]: "";
  var id        = (adict["/* ID"].startsWith("/*") === false && adict["/* img url"].startsWith("/*") !== "") ? adict["/* ID"]: "";
  
  var style = "";
  if (adict["/* Style"].startsWith("/*") === false){
    style = adict["/* Style"];
  }

  if(style === ""){
      var content = `<section class="content ${affil} ${lang}" id="${id}">\n`;
    }else{
      var content = `<section class="content ${affil} ${lang}" id="${id}" style="${style}">\n`;
  }

  if (img_link !== ""){
    //console.log(img_link);
    var img_style = ""; 
    //console.log(adict);
    if (adict["/* img width"].startsWith("/*") === false){
      img_style = img_style + `width: ${adict["/* img width"]};`
    }
    if (adict["/* img height"].startsWith("/*") === false){
      img_style = img_style + `height: ${adict["/* img height"]};`
    }
    if (adict["/* img style"].startsWith("/*") === false){
      img_style = img_style + adict["/* img style"];
    }
    

    if (filter === ""){
      var img_content = `<img src=${img_link} alt="content_img" style="${img_style}" class="content_img">`;
    }else{
      var img_content = `<img src=${img_link} alt="content_img">`;
      img_content = `<div class="content_img_div ${filter}" style="${img_style}">` + img_content + "</div>";
    }

    if (hyperlink === ""){
      content = content + img_content + "\n"
    } else {
      content = content + `<a href="${hyperlink}">` + img_content + "</a>\n";
    }
  }
  
  var converter = new showdown.Converter();
  if (text !== "" && text.startsWith("/*") === false){ 
    let match;
    let matches = [];
    while ((match = MDLINKREG.exec(text)) !== null) { 
        if (match[2].includes("www.dropbox.com")) {
          //console.log(match[2]);
          matches.push(match[2]); 
        }
    }
    for (var i=0; i<matches.length; i++){
      var newlink = uploadImg(matches[i]);
      text = text.replace(matches[i], newlink);
    }
    var html = converter.makeHtml(text);
    content = content + html + "\n";
  }
  
  content = content + "</section>\n";
  //console.log(content);
  return content;
}

function appendCustomPublication(adict){
  console.log(adict["/* Journal link"]);
  var style = "";
  if (adict["/* Margin top"].startsWith("/*") === false){
    style = style + `margin-top: ${adict["/* Margin top"]};`
  }
  
  if (adict["/* Margin bottom"].startsWith("/*") === false){
    style = style + `margin-bottom: ${adict["/* Margin bottom"]};`
  }

  if (adict["/* Equally contributed authors"].startsWith("/*") === false){
    var emembers = adict["/* Equally contributed authors"].split(", ");
  } else { 
    var emembers = [];
  }
  
  if (adict["/* Corresponding authors"].startsWith("/*") === false){
    var cmembers = adict["/* Corresponding authors"].split(", ");
  } else { 
    var cmembers = [];
  }

  if (emembers.length > 0){
    ehtml = '\n<p class="info">+Equally contributed</p>';
  } else {
    ehtml = "";
  }

  if (cmembers.length > 0){
    chtml = '\n<p class="info">*Corresponding authors</p>';
  } else {
    chtml = "";
  }

  var paper_url = adict["/* Journal link"]; 
  var pdf_link  = (adict["/* PDF link"].startsWith("/*") === false) ? uploadImg(adict["/* PDF link"]) : "";
  var img_link  = (adict["/* img url"].startsWith("/*") === false) ? uploadImg(adict["/* img url"]) : "";
  var supinfo   = adict["/* Related info"];
  
  var affil     = adict["Lab"];
  var lang      = adict["Language"].replace(/,/g,"");
  var id        = (adict["/* ID"].startsWith("/*") === false) ? adict["/* ID"]: "";

  if (supinfo.startsWith("/*") === false){
    var converter = new showdown.Converter();
    
    let match;
    let matches = [];
    while ((match = MDLINKREG.exec(supinfo)) !== null) { 
        if (match[2].includes("www.dropbox.com")) {
          matches.push(match[2]); 
        }
    }
    for (var i=0; i<matches.length; i++){
      var newlink = uploadImg(matches[i]);
      supinfo = supinfo.replace(matches[i], newlink);
    }
    
    var msupinfo  = converter.makeHtml(supinfo);
    msupinfo = "\n" + msupinfo.replace("<p>","<p class='supinfo'>");
  } else {
    msupinfo = "";
  }

  var author_html = adict["/* Authors"];
  if (adict["/* Highlighted authors"].startsWith("/*") === false){
    var hmembers = adict["/* Highlighted authors"].split(", ");
  } 
  
  //console.log(hmembers, author_html);
  for(var i=0; i<hmembers.length; i++){
    if(author_html.includes(hmembers[i])){
      author_html = author_html.replace(hmembers[i], `<span class="member">${hmembers[i]}</span>`);
    }
  }
  
  author_html = `<p class="author">${author_html}</p>`;
  var title_html = `<p class="title">${adict["/* Title"]}.</p>`;  

  if (adict["/* Vol"] === ""){
      null;
  }else{
       adict["/* Vol"] = adict["/* Vol"]+", " 
  }

  if (adict["/* Page"] === ""){
      null;
  }else{
       adict["/* Page"] = adict["/* Page"]+", " 
  }

  if(adict["/* PDF link"].startsWith("/*")===false){
    info_html = `<p class="info"><a class="JT" href="${paper_url}">${adict["/* Journal"]} </a> ${adict["/* Vol"]}${adict["/* Page"]}${adict["/* Year, Date"]} <a class="pdf-link" href="${pdf_link}">PDF</a></p>`;
  }else{
    info_html = `<p class="info"><a class="JT" href="${paper_url}">${adict["/* Journal"]} </a> ${adict["/* Vol"]}${adict["/* Page"]}${adict["/* Year, Date"]}</p>`;
  }
  var paper_html = author_html + "\n" + title_html + "\n" + info_html + ehtml + chtml + msupinfo;
  
  if (img_link === ""){
    if (style === ""){
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}">\n<section class="paper_txt_wo_photo">${paper_html}\n</section>\n</section>\n`;
    } else {
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}" style="${style}">\n<section class="paper_txt_wo_photo">${paper_html}\n</section>\n</section>\n`;
    }
  }else{
    if (style === ""){
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}">\n<section class="paper_txt_w_photo">${paper_html}\n</section>\n<section class="paper_photo">\n`
    } else { 
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}" style="${style}">\n<section class="paper_txt_w_photo">${paper_html}\n</section>\n<section class="paper_photo">\n`
    }
    paper_html = paper_html + `<img class="personal_img" src=${img_link} alt="paper_img">\n`;
    paper_html = paper_html + `</section>\n</section>\n`;
  }
  
  return paper_html
} 

function appendPublication(adict){
  console.log(adict["/* Pubmed ID"], adict["/* Journal link"]);
  var style = "";
  if (adict["/* Margin top"].startsWith("/*") === false){
    style = style + `margin-top: ${adict["/* Margin top"]};`
  }
  
  if (adict["/* Margin bottom"].startsWith("/*") === false){
    style = style + `margin-bottom: ${adict["/* Margin bottom"]};`
  }
  
  if (adict["/* Equally contributed authors"].startsWith("/*") === false){
    var emembers = adict["/* Equally contributed authors"].split(", ");
  } else { 
    var emembers = [];
  }
  
  if (adict["/* Corresponding authors"].startsWith("/*") === false){
    var cmembers = adict["/* Corresponding authors"].split(", ");
  } else { 
    var cmembers = [];
  }

  if (adict["/* Highlighted authors"].startsWith("/*") === false){
    var hmembers = adict["/* Highlighted authors"].split(", ");
  } else { 
    var hmembers = MEMBERS;
  }

  var affil     = adict["Lab"];
  var lang      = adict["Language"].replace(/,/g,"");
  var id        = (adict["/* ID"].startsWith("/*") === false) ? adict["/* ID"]: "";

  var pmid      = adict["/* Pubmed ID"]; 
  var paper_url = adict["/* Journal link"]; 
  var pdf_link  = adict["/* PDF link"];
  var pdf_link  = (adict["/* PDF link"].startsWith("/*") === false) ? uploadImg(adict["/* PDF link"]) : "";
  var img_link  = (adict["/* img url"].startsWith("/*") === false) ? uploadImg(adict["/* img url"]) : "";
  var supinfo   = adict["/* Related info"];
  
  if(pmid.startsWith("/*") === false){
    //var url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/?format=pubmed`;
    //console.log(url);
    const url =
    "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
    "?db=pubmed" +
    "&id=" + encodeURIComponent(pmid) +
    "&rettype=medline" +
    "&retmode=text" +
    "&tool=my_gas_script" +
    "&email=contact@example.invalid";
    var bibdict = pmid_bibdict(url);
    //console.log(bibdict["JT"], PubRepDict, bibdict["JT"] in PubRepDict);
    if(bibdict["JT"] in PubRepDict){
      bibdict["JT"] = PubRepDict[bibdict["JT"]]; 
    }
    var paper_html = pmid_html(bibdict, hmembers, pmid, paper_url, pdf_link, img_link, style, emembers, cmembers, supinfo, affil, lang, id);
  } else {
    var pattern = /\d+\.\d+\/\d{4}\.\d{2}\.\d{2}\.\d+/;
    var match = paper_url.match(pattern);
    var url = "https://api.biorxiv.org/details/biorxiv/" + match;
    var bibdict = biorxiv_bibdict(url);
    var paper_html = biorxiv_html(bibdict, hmembers, match, paper_url, pdf_link, img_link, style, emembers, cmembers, supinfo, affil, lang, id);
  }
  return paper_html;
}

function appendPost(adict){ 
  var style = "";
  if (adict["/* Style"].startsWith("/*") === false){
    style = style + adict["/* Style"];
  }
  
  var affil     = adict["Lab"];
  var lang      = adict["Language"].replace(/,/g,"");
  var link      = (adict["/* Link"].startsWith("/*") === false) ? adict["/* Link"]: "";
  if(link.includes("twitter.com")||link.includes("x.com")){
    link = link.replace("x.com","twitter.com");
    console.log(link);
    link = `<blockquote class="pre-twitter-tweet"><a href="${link}"></a></blockquote>`; 
    //<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>
  } else if (link.includes("bsky,app")){
    link = link.replace(/<script.*?<\/script>/gs, '');
    link = link.replace('class="bluesky-embed"', 'class="pre-bluesky-embed"');
    //<script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>
  } else if (link.includes("instagram.com")){
    link = `<blockquote class="pre-instagram-media" data-instgrm-captioned data-instgrm-permalink="${link}/?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14" style=" background:#FFF; border:0; border-radius:3px; box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15); margin: 1px; max-width:540px; min-width:326px; padding:0; width:99.375%; width:-webkit-calc(100% - 2px); width:calc(100% - 2px);"></blockquote>`; // <script async src="https://www.instagram.com/embed.js"></script>`
  }
  
  var id        = (adict["/* ID"].startsWith("/*") === false) ? adict["/* ID"]: "";

  if(style === ""){
      var content = `<section class="content sns-post ${affil} ${lang}" id="${id}">\n`;
    }else{
      var content = `<section class="content sns-post ${affil} ${lang}" id="${id}" style="${style}">\n`;
  }
  //var converter = new showdown.Converter();
  content = content + link + "\n";
  content = content + "</section>\n";
  //console.log(content);
  return content;
}

function appendNews(adict){
  var affil     = adict["Lab"];
  var lang      = adict["Language"].replace(/,/g,"");
  var name      = (adict["/* Name"].startsWith("/*") === false) ? adict["/* Name"]: "";
  var date      = (adict["/* Date"].startsWith("/*") === false) ? adict["/* Date"]: "";
  var text      = (adict["/* Text"].startsWith("/*") === false) ? adict["/* Text"]: "";
  var converter = new showdown.Converter();
  text = converter.makeHtml(text);
  //if (text !== "" && text.startsWith("/*") === false){   
  //  var html = converter.makeHtml(text);
  //  console.log(html)
  //}
  var avt_link  = (adict["/* Avatar img url"].startsWith("/*") === false && adict["/* Avatar img url"].startsWith("/*") !== "") ? uploadImg(adict["/* Avatar img url"]): "";
  var img_link1  = (adict["/* img url1"].startsWith("/*") === false && adict["/* img url1"].startsWith("/*") !== "") ? uploadImg(adict["/* img url1"]): "";
  var img_link2  = (adict["/* img url2"].startsWith("/*") === false && adict["/* img url2"].startsWith("/*") !== "") ? uploadImg(adict["/* img url2"]): "";
  var content = `<div class="x-embed ${affil} ${lang}">\n`;
  content = content + `  <article class="tweet-embed" role="article" aria-label="Tweet">\n`;
  content = content + `    <header class="t-header">\n`;
  content = content + `      <div class="avatar" aria-hidden="true">\n`;
  content = content + `        <img alt="" src=${avt_link} />\n`;
  content = content + `      </div>\n`;
  content = content + `      <div class="who">\n`;
  content = content + `        <div class="name">${name}</div>\n`;
  content = content + `      </div>\n`;
  content = content + `    </header>\n`;
  content = content + `    <div class="t-body">\n`;
  content = content + `      <p>${text}</p>\n`;
  if (img_link1 === "" && img_link2 === ""){
    null;
  }else if(img_link2 === ""){
    content = content + `      <div class="media-grid is-1">\n`;
    content = content + `        <div class="item"><img alt="" src=${img_link1}></div>\n`;
    content = content + `      </div>\n`;
  }else{
    content = content + `      <div class="media-grid is-2">\n`;
    content = content + `        <div class="item"><img alt="" src=${img_link1}></div>\n`;
    content = content + `        <div class="item"><img alt="" src=${img_link2}></div>\n`;
    content = content + `      </div>\n`;
  }
  content = content + `    </div>\n`;
  content = content + `    <div class="t-meta">\n`;
  content = content + `      <span>${date}</span>\n`;
  content = content + `    </div>\n`;
  content = content + `  </article>\n`;
  content = content + `</div>\n`; 
  return content;
}

function appendDivStart(adict){
  var style = "";
  var direction = (adict["/* Direction"].startsWith("/*") === true) ? "h": adict["/* Direction"];
  if (direction === "h"){
    style = "display: flex; flex-direction: row; justify-content: flex-start;";
  } else if (direction === "v"){
    style = "display: flex; flex-direction: column; justify-content: flex-start;";
  }
  if (adict["/* Style"].startsWith("/*") === false){
    style = style + adict["/* Style"];
  }
  
  var affil = adict["Lab"];
  var lang  = adict["Language"].replace(/,/g,"");
  var id = (adict["/* ID"].startsWith("/*") === false) ? adict["/* ID"]: "";

  if (style === ""){
    var content = `<div class="${affil} ${lang}"`;
  }else{
    var content = `<div class="${affil} ${lang}" style="${style}"`;
  }
  if (id !== ""){
    content = content + ` id="${id}">\n`;
  } else {
    content = content + ">\n";
  }
  return content;
}

function appendDivEnd(){
  return "</div>\n";
}

function getMembers(){
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var parameter_sheet = spreadsheet.getSheetByName("parameters");
  var data = parameter_sheet.getDataRange().getValues();
  var parameter_dict = {};
  for (var i = 1; i < data.length; i++) {
    var key    = data[i][0];
    var values = data[i].slice(1);
    for (var j = 0; j < values.length; j++){
      values[j] = values[j].replace(/ \(.+\)/, "");
    }
    parameter_dict[key] = ["Lab", "Language", "Function"].concat(values);
  }
  
  var members = [] 
  var sheet1 = spreadsheet.getSheetByName("people");
  var sheet2 = spreadsheet.getSheetByName("alumni");
  var sheets = [sheet1, sheet2];
  for (var i=0; i<sheets.length; i++){
    var sheet = sheets[i]; 
    var data  = sheet.getDataRange().getValues();
    var adict = {};
    for (var j = 0; j < data.length; j++) {
      if (data[j][2] === "Member"){ 
        for (var k = 0; k < data[j].length; k++) {
          adict[parameter_dict["Member"][k]] = data[j][k];
        }
        //console.log(adict);
        if(adict["/* Name in publication"].startsWith("/*") === false){ 
          members = members.concat(adict["/* Name in publication"].split(", "));
        }
      } 
    }
  }
  return members;
}

function pmid_bibdict(url){
  //var response = previewFetch_(url);
  //var nbibContent = response.getContentText();
  let nbibContent = null;
  for (let i = 0; i < 10; i++) {
    try {
      Utilities.sleep(350);
      const res = previewFetch_(url, { muteHttpExceptions: true });
      nbibContent = res.getContentText();
      break;
    } catch (e) {
      Utilities.sleep(1000);
    }
  }

  if (!nbibContent) {
    throw new Error('fetch失敗');
  }
  var lines = nbibContent.split('\n');
  //console.log(lines);
  var bibdict = {};
  var currentKey = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line) {
      var parts = line.split('- ');
      if (parts.length === 2) {
        currentKey = parts[0].trim();
        var value = parts[1].trim();
        if (bibdict.hasOwnProperty(currentKey)) {
            if (Array.isArray(bibdict[currentKey])) {
                bibdict[currentKey].push(value);
            } else {
                bibdict[currentKey] = [bibdict[currentKey], value];
            }
        } else {
            bibdict[currentKey] = value;
        }
      } else if (currentKey && bibdict.hasOwnProperty(currentKey)) {
        if (Array.isArray(bibdict[currentKey])) {
          bibdict[currentKey][bibdict[currentKey].length - 1] += ' ' + line;
        } else {
          bibdict[currentKey] += ' ' + line;
        }
      }
    }
  }
  //console.log(bibdict);
  return bibdict
}

function biorxiv_bibdict(url){
  Utilities.sleep(350);
  var response = previewFetch_(url);
  var jsonData = JSON.parse(response.getContentText());
  var jsonData = jsonData["collection"][0] 
  var bibdict = {}; 
  bibdict["AU"] = jsonData["authors"].split(";")
  for (var i = 0; i<bibdict["AU"].length; i++){
    bibdict["AU"][i] = bibdict["AU"][i].replace(".","");
    bibdict["AU"][i] = bibdict["AU"][i].replace(",","");
  }  
  bibdict["TI"] = jsonData["title"]
  return bibdict
}

function pmid_html(result, members, pmid, paper_url, pdf_link, img_link, style, emembers, cmembers, supinfo, affil, lang, id){
  var authors = result["AU"];
  var title_html  = `<p class="title">${result["TI"]}</p>`;
  var author_html = "";
  for (var i = 0; i < authors.length; i++){
    var author_original = authors[i];
    var author = authors[i];
    if (cmembers.includes(author_original)){
      author = author + "*";
    }
    if (emembers.includes(author_original)){
      author = author + "+";
    }

    if (members.includes(author_original)){
      author = `<span class="member">${author}</span>`;
    }else{
      author = author;
    }   
    if (i==authors.length-1){
      author_html += " & " + author;
    }else if(i === 0){
      author_html += author;
    }else{
      author_html += ", " + author;
    }
  }
  author_html = `<p class="author">${author_html}</p>`;
  

  //info_html = `<p class="info"><a class="JT" href="${paper_url}">${result["JT"]}</a> ${result["VI"]}, ${result["PG"]}, ${result["DP"].split(" ")[0]} <a class="PMID" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/">PubMed</a></p>`;

  //console.log(result["VI"]);
  if (pdf_link === ""){
    if (result["VI"] === undefined) {
      info_html = `<p class="info"><a class="JT" href="${paper_url}">${result["JT"]}</a> ${result["DP"].split(" ")[0]} <a class="PMID" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/">PubMed</a></p>`;
    }else{
      info_html = `<p class="info"><a class="JT" href="${paper_url}">${result["JT"]}</a> ${result["VI"]}, ${result["PG"]}, ${result["DP"].split(" ")[0]} <a class="PMID" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/">PubMed</a></p>`;
    }
  }else {
    if (result["VI"] === undefined) {
      info_html = `<p class="info"><a class="JT" href="${paper_url}">${result["JT"]}</a> ${result["DP"].split(" ")[0]} <a class="PMID" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/">PubMed</a> <a class="pdf-link" href="${pdf_link}">PDF</a></p>`;
    }else{
      info_html = `<p class="info"><a class="JT" href="${paper_url}">${result["JT"]}</a> ${result["VI"]}, ${result["PG"]}, ${result["DP"].split(" ")[0]} <a class="PMID" href="https://pubmed.ncbi.nlm.nih.gov/${pmid}/">PubMed</a> <a class="pdf-link" href="${pdf_link}">PDF</a></p>`;
    }
  }

  
  if (emembers.length > 0){
    ehtml = '\n<p class="info">+Equally contributed</p>';
  } else {
    ehtml = "";
  }

  if (cmembers.length > 0){
    chtml = '\n<p class="info">*Corresponding authors</p>';
  } else {
    chtml = "";
  }

  if (supinfo.startsWith("/*") === false){
    var converter = new showdown.Converter();
    
    let match;
    let matches = [];
    while ((match = MDLINKREG.exec(supinfo)) !== null) { 
        if (match[2].includes("www.dropbox.com")) {
          matches.push(match[2]); 
        }
    }
    for (var i=0; i<matches.length; i++){
      var newlink = uploadImg(matches[i]);
      supinfo = supinfo.replace(matches[i], newlink);
    }
    
    var msupinfo  = converter.makeHtml(supinfo);
    msupinfo = "\n" + msupinfo.replace("<p>","<p class='supinfo'>");
  } else {
    msupinfo = "";
  }

  var paper_html = author_html + "\n" + title_html + "\n" + info_html + ehtml + chtml + msupinfo;
  if (img_link === ""){
    if (style === ""){
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}">\n<section class="paper_txt_wo_photo">${paper_html}\n</section>\n</section>\n`;
    } else {
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}" style="${style}">\n<section class="paper_txt_wo_photo">${paper_html}\n</section>\n</section>\n`;
    }
  }else{
    if (style === ""){
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}">\n<section class="paper_txt_w_photo">${paper_html}\n</section>\n<section class="paper_photo">\n`
    } else { 
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}" style="${style}">\n<section class="paper_txt_w_photo">${paper_html}\n</section>\n<section class="paper_photo">\n`
    }
    paper_html = paper_html + `<img class="personal_img" src=${img_link} alt="paper_img">\n`;
    paper_html = paper_html + `</section>\n</section>\n`;
  }
  return paper_html;
}

function biorxiv_html(result, members, bxid, paper_url, pdf_link, img_link, style, emembers, cmembers, supinfo, affil, lang, id){
  var authors = result["AU"];
  var title_html  = `<p class="title">${result["TI"]}</p>`;
  var author_html = "";
  var members_wo_space = []
  
  for (var i = 0; i < members.length; i++){
    members_wo_space.push(members[i].replace(/ /g,""));  
  } 
  
  for (var i = 0; i < authors.length; i++){
    var author_original = authors[i].replace(/\./g,""); 
    var author = authors[i].replace(/\./g,"");
    var author_wo_space = authors[i].replace(/ /g,"").replace(/\./g,"");

    if (cmembers.includes(author_original)){
      author = author + "*";
    }

    if (emembers.includes(author_original)){
      author = author + "+";
    }

    if (members_wo_space.includes(author_wo_space)){
      author = `<span class="member">${author}</span>`;
    }else{
      author = author;
    }   
    if (i==authors.length-1){
      author_html += " & " + author;
    }else if(i === 0){
      author_html += author;
    }else{
      author_html += ", " + author;
    }
  }
  author_html = `<p class="author">${author_html}</p>`;
  
  if (pdf_link === ""){
    info_html = `<p class="info"><a class="JT" href="${paper_url}">bioRxiv</a> ${bxid}</p>`;
  } else {
    info_html = `<p class="info"><a class="JT" href="${paper_url}">bioRxiv</a> ${bxid} <a class="pdf-link" href="${pdf_link}">PDF</a></p>`;
  }

  if (emembers.length > 0){
    ehtml = '\n<p class="info">+Equally contributed</p>';
  } else {
    ehtml = "";
  }

  if (cmembers.length > 0){
    chtml = '\n<p class="info">*Corresponding authors</p>';
  } else {
    chtml = "";
  }
  
  if (supinfo.startsWith("/*") === false){
    var converter = new showdown.Converter();

    let match;
    let matches = [];
    while ((match = MDLINKREG.exec(supinfo)) !== null) { 
        if (match[2].includes("www.dropbox.com")) {
          matches.push(match[2]); 
        }
    }
    for (var i=0; i<matches.length; i++){
      var newlink = uploadImg(matches[i]);
      supinfo = supinfo.replace(matches[i], newlink);
    }
    
    var msupinfo  = converter.makeHtml(supinfo);
    msupinfo = "\n" + msupinfo.replace("<p>","<p class='supinfo'>");
  } else {
    msupinfo = "";
  }
  
  var paper_html = author_html + "\n" + title_html + "\n" + info_html + ehtml + chtml + msupinfo;

  if (img_link === ""){
    if (style === ""){
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}">\n<section class="paper_txt_wo_photo">${paper_html}\n</section>\n</section>\n`;
    }else{
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}" style="${style}">\n<section class="paper_txt_wo_photo">${paper_html}\n</section>\n</section>\n`;
    }
  }else{
    if (style === ""){
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}">\n<section class="paper_txt_w_photo">${paper_html}\n</section>\n<section class="paper_photo">\n`;
    } else {
      paper_html = `<section class="paper ${affil} ${lang}" id="${id}" style="${style}">\n<section class="paper_txt_w_photo">${paper_html}\n</section>\n<section class="paper_photo">\n`;
    }
    paper_html = paper_html + `<img class="personal_img" src=${img_link} alt="paper_img">\n`;
    paper_html = paper_html + `</section>\n</section>\n`;
  }
  return paper_html;
}