Promise.all([
	new Promise(function(resolve, reject) {
		console.debug("[dexcom] loading");
		dexcom.connect().then(function() {
			console.debug("[dexcom] loaded");
			return dexcom.readFromReceiver(1);
		}, function(e) {
			console.log("[dexcom] rejected");
			reject(e);
		}).then(function(d) {
			console.debug("[dexcom] read; disconnecting");
			dexcom.disconnect();
			resolve(d);
		});
	}),
	new Promise(function(resolve) {
		console.debug("[mongoconfig] Loading");
		$.ajax({
			url: "../mongoconfig.json", 
			success: function(d) {
				console.debug("[mongoconfig] loaded");
				resolve(JSON.parse(d));
			}
		});
	}),
	new Promise(function(resolve) {
		console.debug("[diypsconfig] Loading");
		$.ajax({
			url: "../diypsconfig.json", 
			success: function(d) {
				console.debug("[diypsconfig] loaded");
				resolve(JSON.parse(d));
			}
		});
	})
]).then(function(results) {
	var data = results[0],
		mongoconfig = results[1],
		diypsconfig = results[2];
	saveToMongoLab = function(data) {
		// $.ajax({
		// 	url: "https://api.mongolab.com/api/1/databases/dexcomhistory/collections/egv?apiKey=" + mongoconfig.apikey,
		// 	data: JSON.stringify(data.map(function(plot) {
		// 		return {
		// 			device: "dexcom",
		// 			timestamp: +plot.displayTime,
		// 			bg: plot.bgValue,
		// 			direction: plot.trend
		// 		};
		// 	})),
		// 	type: "POST",
		// 	contentType: "application/json"
		// });	
	},
	saveToDiyPS = function(data) {
		console.debug("[saveToDiyPS] firing off");
		if (diypsconfig.length)
		$.post(diypsconfig.endPoint,
			{
				records: JSON.stringify(data.map(function(plot) {
					return [
						+plot.displayTime,
						plot.bgValue,
						plot.trend
					];
				}))
			}
		);
	};

	var lastNewRecord = Date.now();
	
	var updateLocalDb = function(data) {
		return new Promise(function(resolve) {
			chrome.storage.local.get("egvrecords", function(storage) {
				var existing = storage.egvrecords || [];
				var max_existing = existing.length > 0?  existing[existing.length - 1].displayTime : 0;
				var new_records = data.filter(function(egv) {
					return +egv.displayTime > max_existing;
				}).map(function(egv) {
					return {
						displayTime: +egv.displayTime,
						bgValue: egv.bgValue,
						trend: egv.trend
					};
				});
				var to_save = existing.concat(new_records);
				to_save.sort(function(a,b) {
					return a.displayTime - b.displayTime;
				})
				chrome.storage.local.set({ egvrecords: to_save }, console.debug.bind(console, "[updateLocalDb] Saved results"));
				console.log("%i new records", new_records.length);
				if (new_records.length == 0) {
					if (lastNewRecord + (5).minutes() < Date.now()) {
						console.log("[updateLocalDb] Something's wrong. We should have new data by now.");
					}
				} else {
					lastNewRecord = Date.now();
				}
				resolve();
			});
		});
		
	};
	updateLocalDb(data);
	setInterval(function() {
		console.log("Attempting to refresh data");
		try {
			dexcom.connect().then(function() {
				return dexcom.readFromReceiver(1);
			}).then(updateLocalDb).then(function() {
				dexcom.disconnect();
			});
		} catch (e) {
			console.debug(e);
		}
	}, (30).seconds());
});

var saveToMongoLab = function() {
	// stub
}

var saveToDiyPS = function() {
	// stub
}

function drawReceiverChart(data) {
	var t = 3; //parseInt($("#timewindow").val(),10);
	var now = (new Date()).getTime();
	var trend = data.map(function(plot) {
		return [
			+plot.displayTime,
			plot.bgValue
		];
	}).filter(function(plot) {
		return plot[0] + t.hours() > now;
	});
	$.plot(
		"#dexcomtrend",
		[{
			label: "#CGMthen",
			data: trend
		}],
		{
			xaxis: {
				mode: "time"
			}
		}
	);
	$("#cgmnow").text(data[data.length - 1].bgValue);
	$("#cgmdirection").text(data[data.length - 1].trend);
	$("#cgmtime").text((new Date(data[data.length - 1].displayTime)).toTimeString());
}

// updated database
chrome.storage.onChanged.addListener(function(changes, namespace) {
	if ("egvrecords" in changes)  {
		drawReceiverChart(changes.egvrecords.newValue);
		saveToMongoLab(changes.egvrecords.newValue);
		saveToDiyPS(changes.egvrecords.newValue);
	}
});

// first load
chrome.storage.local.get("egvrecords", function(values) {
	drawReceiverChart(values.egvrecords);
});

$(function() {
	$('#reset').confirmation({
		title: "Are you sure? This will delete all your data and cannot be undone.",
		onConfirm: function() {
			chrome.storage.local.remove("egvrecords", function() { });
		}
	});
	$('#import').click(function(b){
		var i = 1;
		var data = [];
		debugger;
		var compile = function(i) {
			return new Promise(function(resolve,reject) {
				dexcom.readFromReceiver(i).then(function(d) {
					data.push(d);

					if (d.length) {
						resolve(d);	
					} else {
						reject();
					}
				});
			});
		},
		reader = function() {
			compile(i).then(function() {
				i++;
				reader();
			}, function() {
				dexcom.disconnect();
				var existing = [];
				var new_records = Array.prototype.concat.apply([], data).map(function(egv) {
					return {
						displayTime: +egv.displayTime,
						bgValue: egv.bgValue,
						trend: egv.trend
					};
				});
				var to_save = existing.concat(new_records);
				to_save.sort(function(a,b) {
					return a.displayTime - b.displayTime;
				});
				chrome.storage.local.remove("egvrecords", function() {
					chrome.storage.local.set({ egvrecords: to_save }, console.debug.bind(console, "[updateLocalDb] Saved results"));
				});
				console.log("%i new records (about %i days)", new_records.length, Math.ceil(data.length * 3 / 4)); // 1 page holds about 18h (3/4 of 1 day)
			});
		};
		dexcom.connect().then(reader);
	});
});