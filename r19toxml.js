
var params = [];

if ( process.argv.length < 3 ) { showUsage(); return; }

process.argv.forEach(function (val, index, array) {
	if (index > 1 ){
        params.push(val);
    }
});

if ( params.length < 1 ) {showUsage(); return;}

var SEPA = require("sepa");
var fs = require('fs');
var Q = require('q');
var BICFromIBAN = require ("./Bic-from-IBAN/BICFromIBAN");

fs.exists(params[0], function(exists) {
	if (!exists) { console.log("\nFile: " + params[0] + " not exists."); return;}

	if ( params.length == 1 ) { 
		params[1] = params[0] + ".xml"; 
	}else{
		if(params[1].substr(-4) != '.xml') { 
			params[1] = params[1] + ".xml"; 
		}
	}
	
	fs.exists(params[1], function(exists) {
		if (exists) { 
			console.log("\nFile: " + params[1] + " already exists."); return; 
		}else{
			convertFile(params[0], params[1]);
		}
	});
})

function convertFile(source, output){
	var input = fs.createReadStream(source);
	
	readLines(input, procesLines).then((data) => {
		fs.writeFile(output , data, function(err) {
		    if(err) {
		        return console.log(err);
		    }
		    console.log("The file was saved!");
		});
	},(error) => {
		return console.log(error);
	});
}

function readLines(input, callback) {
	var deferred = Q.defer()
	var lines = [];
    var remaining = '';
    input.on('data', (data) => {
        remaining += data;
        var index = remaining.indexOf('\n');
        var last = 0;
        while (index > -1) {
            var line = remaining.substring(last, index);
            last = index + 1;
            lines.push(line);
            index = remaining.indexOf('\n', last);
        }

        remaining = remaining.substring(last);
    });

    input.on('end', () => {
        if (remaining.length > 0) {
            lines.push(remaining);
        }
        callback(lines).then((data) => {
        	deferred.resolve(data);
        },(error) => {
        	deferred.reject(error);
        });
    });

    return deferred.promise;
}

function procesLines(lines) {
	var deferred = Q.defer();
	if ( lines.length == 0 ) deferred.reject("The file is empty");
	var doc = new SEPA.Document('pain.008.001.02');

	var info;

	AsyncForEach (lines, (item, index, next) => {
		var lineType = item.substring(0, 2);
		switch (lineType){
			case "01":
				// File header
				posline = [2,5,3,35,70,8,35,4,4,434];
				cutString(posline, item, (data) => {
					//console.log(data);
					doc.grpHdr.id = data[6].substring(0, 32);
					doc.grpHdr.created = new Date(data[5].substring(0, 4) + "-" + data[5].substring(4, 6) + "-" + data[5].substring(6, 8));
					doc.grpHdr.initiatorName = data[4];
					next();
				});
			break;
			case "02":
				// Section header
				posline = [2,5,3,35,8,70,50,50,40,2,34,301];
				cutString(posline, item, (data) => {
					//console.log(data);
					if ( SEPA.validateIBAN( data[10]) ) {
						if ( SEPA.validateCreditorID( data[3]) ) {
							info = new SEPA.PaymentInfo();
							info.sequenceType="RCUR";
							info.collectionDate = new Date(data[4].substring(0, 4) + "-" + data[4].substring(4, 6) + "-" + data[4].substring(6, 8));
							info.creditorIBAN = data[10];
							info.creditorBIC = BICFromIBAN.getBIC(data[10]);
							info.creditorName = data[5];
							info.creditorId = data[3];
							doc.addPaymentInfo(info);
							next();
						}else{
							deferred.reject("Validation error on Creditor ID " +  data[3])
						}
					}else{
						deferred.reject("Validation error on IBAN " +  data[10])
					}
				})
			break;
			case "03":
				// transaction
				posline = [2,5,3,35,35,4,4,11,8,11,70,50,50,40,2,1,36,35,1,34,4,140,19];
				cutString(posline, item, (data) => {
					//console.log(data);
					if ( SEPA.validateIBAN( data[19]) ) {
						var tx = new SEPA.Transaction();
						tx.debitorName = data[10];
						tx.debitorIBAN = data[19];
						tx.debitorBIC = BICFromIBAN.getBIC(data[19]);
						tx.mandateId = data[4];
						tx.mandateSignatureDate = new Date(data[8].substring(0, 4) + "-" + data[8].substring(4, 6) + "-" + data[8].substring(6, 8));
						tx.amount = parseFloat(( parseInt( data[7].replace(/^0+/, '') )/ 100).toFixed(2));
						tx.remittanceInfo = data[21];
						tx.end2endId = data[3];
						info.addTransaction(tx);
						next ();
					}else{
						deferred.reject("Validation error on IBAN " +  data[19]);
					}
				})
				
			break;
			default:
				next();
			break;
		}
	}, function (){
		var txt = doc.toString().replace('<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.003.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="urn:iso:std:iso:20022:tech:xsd:pain.008.003.02 pain.008.003.02.xsd">', '<Document xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02">');
		deferred.resolve("<?xml version='1.0' encoding='ISO-8859-1'?>" + txt);
	});
	return deferred.promise;
}

function cutString (positions, str, callback){
	var response = [];
	var position = 0;
	AsyncForEach (positions, (item, index, next) => {
		var minstr = str.substring(position, position + parseInt(item)).trim();
		response.push(minstr);
		position += parseInt(item);
		next();
	}, ()=> {
		callback( response );
	});
}

AsyncForEach = function (array, fn, callback) {
	array = array.reverse().slice(0);
    var counter=-1;
    function processOne() {
        var item = array.pop();
        counter++;
        fn(item, counter, function(result) {
            if(array.length > 0) {
                setTimeout(processOne, 0);
            } else {
                callback();
            }
        });
    }
    if(array.length > 0) {
        setTimeout(processOne, 0);
    } else {
        callback();
    }
}

function showUsage (){
    console.log("\nUsage: node r19toxml.js source_r19_file output_xml_file\n");
}