function sendUserError(message) {
  var cc = DataStudioApp.createCommunityConnector();
  cc.newUserError()
    .setText(message)
    .throwException();
}

function getAuthType() {
  var response = {type: 'NONE'};
  return response;
}

function getConfig(request) {
  var communityConnector = DataStudioApp.createCommunityConnector();
  var connectorConfig = communityConnector.getConfig();

  connectorConfig.setDateRangeRequired(false);

  connectorConfig
    .newTextInput()
    .setId('url')
    .setName('Enter the URL of your CSV');

  connectorConfig
    .newTextInput()
    .setId('userpass')
    .setName('Enter user:pass for Basic Auth protection');

  connectorConfig
    .newSelectSingle()
    .setId('delimiter')
    .setName('Select the delimiter between each value')
    .setAllowOverride(false)
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('Comma')
        .setValue(',')
    )
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('Semicolon')
        .setValue(';')
    )
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('Tabulation')
        .setValue('\t')
    );

  connectorConfig
    .newSelectSingle()
    .setId('textQualifier')
    .setName('Are the values surrounded by single or double quotes?')
    .setAllowOverride(false)
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('No Quotes')
        .setValue('undefined')
    )
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('Single Quotes')
        .setValue("'")
    )
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('Double Quotes')
        .setValue('"')
    );

  connectorConfig
    .newTextInput()
    .setId('numericfields')
    .setName('Fields with numeric values');

  connectorConfig
    .newSelectSingle()
    .setId('containsHeader')
    .setName('Does the CSV have a header row?')
    .setAllowOverride(false)
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('True')
        .setValue('true')
    )
    .addOption(
      connectorConfig
        .newOptionBuilder()
        .setLabel('False')
        .setValue('false')
    );

  return connectorConfig.build();
}

function findLineSeparator(content) {
  if (!content) {
    return undefined;
  }
  if (content.indexOf('\r\n') >= 0) {
    // Windows
    return '\r\n';
  } else if (content.indexOf('\r') >= 0) {
    // MacOS
    return '\r';
  } else if (content.indexOf('\n') >= 0) {
    // Linux / OSX
    return '\n';
  } else {
    return undefined;
  }
}

function fetchData(url, userpass) {
  if (!url || !url.match(/^https?:\/\/.+$/g)) {
    sendUserError('"' + url + '" is not a valid url.');
  }
  var response;
  Logger.log("Start Fetching");
  if (userpass != ""){
    var headers = {
      "Authorization" : "Basic " + Utilities.base64Encode(userpass),
    };
    var params = {
      "method":"GET",
      "headers":headers
    };
    var response = UrlFetchApp.fetch(url, params);
    var content = response.getContentText();
    if (!content) {
      Logger.log("Error FetchData with password")
      sendUserError('"' + url + '" returned no content.');
    }
    Logger.log("End Fetching");
    return content;
  }else {
    var response = UrlFetchApp.fetch(url);
    var content = response.getContentText();
    if (!content) {
      Logger.log("Error FetchData with password")
      sendUserError('"' + url + '" returned no content.');
    }
    Logger.log("End Fetching");
    return content;
  }
}

function getFields(request, content) {
  var communityConnector = DataStudioApp.createCommunityConnector();
  var fields = communityConnector.getFields();
  var types = communityConnector.FieldType;
  var textQualifier = request.configParams.textQualifier;
  var containsHeader = request.configParams.containsHeader;

  var lineSeparator = findLineSeparator(content);
  var firstLineContent;
  if (lineSeparator) {
    firstLineContent = content.substring(0, content.indexOf(lineSeparator));
  } else {
    firstLineContent = content;
  }
  var valueSeparator = request.configParams.delimiter;
  if (textQualifier !== 'undefined') {
    firstLineContent = firstLineContent.substring(
      1,
      firstLineContent.length - 1
    );
    valueSeparator = textQualifier + valueSeparator + textQualifier;
  }
  var firstLineColumns = firstLineContent.split(valueSeparator);

  var i = 1;
  firstLineColumns.forEach(function(value) {
    var field = fields.newDimension().setType(types.TEXT);
    if (containsHeader === 'true') {
      // because Id can't have space
      field.setId(value.replace(/\s/g, '_').toLowerCase());
      field.setName(value);
    } else {
      field.setId('column_' + i);
      i++;
    }
  });

  return fields;
}


function getSchema(request) {
  var content = fetchData(request.configParams.url, request.configParams.userpass);
  var fields = getFields(request, content).build();
  return {schema: fields};
}


function getData(request) {
  var content = fetchData(request.configParams.url, request.configParams.userpass);

  var requestedFieldIds = request.fields.map(function(field) {
    return field.name;
  });

  var fields = getFields(request, content);
  var requestedFields = fields.forIds(requestedFieldIds);
  var buildedFields = fields.build();

  var fieldsIndexArray = {}
  buildedFields.forEach(function (val, index){
    fieldsIndexArray[val.name] = index;
  });

  var requestedFieldsIndex = [];
  requestedFields.asArray().forEach(function (f, index){
    requestedFieldsIndex.push(fieldsIndexArray[f.getName()]);
  });

  var textQualifier = request.configParams.textQualifier;
  var delimiter = request.configParams.delimiter;
  var containsHeader = request.configParams.containsHeader;

  var lineSeparator = findLineSeparator(content);
  var contentRows;
  if (lineSeparator) {
    contentRows = content.split(lineSeparator);
  } else {
    contentRows = [content];
  }
  var valueSeparator = delimiter;
  if (textQualifier !== 'undefined') {
    valueSeparator = textQualifier + valueSeparator + textQualifier;
  }

  var rows = contentRows
    .filter(function(contentRow) {
      // Remove rows that are empty.
      return contentRow.trim() !== '';
    })
    .map(function(contentRow, idx) {
      if (textQualifier !== 'undefined') {
        contentRow = contentRow.substring(1, contentRow.length - 1);
      }
      var allValues = contentRow.split(valueSeparator);
      if (buildedFields.length !== allValues.length) {
        sendUserError(
          'Error parsing content. Row: ' +
            idx +
            ' has ' +
            allValues.length +
            ' field(s), but ' +
            buildedFields.length +
            ' field(s) were expected.'
        );
      }
      requestedValues = [];
      requestedFieldsIndex.forEach(function(value) {
        requestedValues.push(allValues[value]);
      });
      return {values: requestedValues};
    });

  if (containsHeader === 'true') {
    rows = rows.slice(1);
  }

  var result = {
    schema: requestedFields.build(),
    rows: rows
  };

  return result;
}
