'use strict';

const apiai = require('apiai');
const config = require('./config');
const express = require('express');
const crypto = require('crypto');
const bodyParser = require('body-parser');
const request = require('request');
const pg = require('pg');
const app = express();
const uuid = require('uuid');
const userService = require('./user');
const colors = require('./colors');
const admin = require("firebase-admin");
let serviceAccount = require("./foodi.json");


let soups = require('./menu_items').SOUPS;
let starter = require('./menu_items').STARTER;
let friedrice = require('./menu_items').FRIEDRICE;
let noodles = require('./menu_items').NOODLES;
let maincourse = require('./menu_items').MAINCOURSE;

pg.defaults.ssl = true;

// Messenger API parameters
if (!config.FB_PAGE_TOKEN) {
	throw new Error('missing FB_PAGE_TOKEN');
}
if (!config.FB_VERIFY_TOKEN) {
	throw new Error('missing FB_VERIFY_TOKEN');
}
if (!config.API_AI_CLIENT_ACCESS_TOKEN) {
	throw new Error('missing API_AI_CLIENT_ACCESS_TOKEN');
}
if (!config.FB_APP_SECRET) {
	throw new Error('missing FB_APP_SECRET');
}
if (!config.SERVER_URL) { //used for ink to static files
	throw new Error('missing SERVER_URL');
}
if (!config.PG_CONFIG) {
	throw new Error('missing PG_CONFIG');
}




admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://foodiebot-701a4.firebaseio.com"
});

let db = admin.database();
let cartref = db.ref("cart");
let orderref = db.ref("orders");




app.set('port', (process.env.PORT || 5000))

//verify request came from facebook
app.use(bodyParser.json({
	verify: verifyRequestSignature
}));

//serve static files in the public directory
app.use(express.static('public'));

// Process application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({
	extended: false
}))

// Process application/json
app.use(bodyParser.json())




const apiAiService = apiai(config.API_AI_CLIENT_ACCESS_TOKEN, {
	language: "en",
	requestSource: "fb"
});
const sessionIds = new Map();
const usersMap = new Map();

// Index route
app.get('/', function (req, res) {
	res.send('Hello world, I am a chat bot')
})

// for Facebook verification
app.get('/webhook/', function (req, res) {
	console.log("request");
	if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === config.FB_VERIFY_TOKEN) {
		res.status(200).send(req.query['hub.challenge']);
	} else {
		console.error("Failed validation. Make sure the validation tokens match.");
		res.sendStatus(403);
	}
})

/*
 * All callbacks for Messenger are POST-ed. They will be sent to the same
 * webhook. Be sure to subscribe your app to your page to receive callbacks
 * for your page. 
 * https://developers.facebook.com/docs/messenger-platform/product-overview/setup#subscribe_app
 *
 */
app.post('/webhook/', function (req, res) {
	var data = req.body;
	console.log(JSON.stringify(data));



	// Make sure this is a page subscription
	if (data.object == 'page') {
		// Iterate over each entry
		// There may be multiple if batched
		data.entry.forEach(function (pageEntry) {
			var pageID = pageEntry.id;
			var timeOfEvent = pageEntry.time;

			// Iterate over each messaging event
			pageEntry.messaging.forEach(function (messagingEvent) {
				if (messagingEvent.optin) {
					receivedAuthentication(messagingEvent);
				} else if (messagingEvent.message) {
					receivedMessage(messagingEvent);
				} else if (messagingEvent.delivery) {
					receivedDeliveryConfirmation(messagingEvent);
				} else if (messagingEvent.postback) {
					receivedPostback(messagingEvent);
				} else if (messagingEvent.read) {
					receivedMessageRead(messagingEvent);
				} else if (messagingEvent.account_linking) {
					receivedAccountLink(messagingEvent);
				} else {
					console.log("Webhook received unknown messagingEvent: ", messagingEvent);
				}
			});
		});

		// Assume all went well.
		// You must send back a 200, within 20 seconds
		res.sendStatus(200);
	}
});


function  setSessionAndUser(senderID) {
    if (!sessionIds.has(senderID)) {
        sessionIds.set(senderID, uuid.v1());
    }

    if (!usersMap.has(senderID))
	{
        userService.addUser(function (user) {
			usersMap.set(senderID,user);
			
        },senderID);
	}

	
}


function receivedMessage(event) {

	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfMessage = event.timestamp;
	var message = event.message;
    setSessionAndUser(senderID);
	
	console.log("Received message for user %d and page %d at %d with message:", senderID, recipientID, timeOfMessage);
	console.log(JSON.stringify(message));

	var isEcho = message.is_echo;
	var messageId = message.mid;
	var appId = message.app_id;
	var metadata = message.metadata;

	// You may get a text or attachment but not both
	var messageText = message.text;
	var messageAttachments = message.attachments;
	var quickReply = message.quick_reply;

	if (isEcho) {
		handleEcho(messageId, appId, metadata);
		return;
	} else if (quickReply) {
		handleQuickReply(senderID, quickReply, messageId);
		return;
	}


	if (messageText) {
		//send message to api.ai
		sendToApiAi(senderID, messageText);
	} else if (messageAttachments) {
		handleMessageAttachments(messageAttachments, senderID);
	}
}


function handleMessageAttachments(messageAttachments, senderID){
	//for now just reply
	sendTextMessage(senderID, "Attachment received. Thank you.");	
}

function handleQuickReply(senderID, quickReply, messageId) {
	var quickReplyPayload = quickReply.payload;

	switch (quickReplyPayload)
	{
		case "NEWS_WEEK":
		{
            userService.newsletterSettings(function (updated) {

				if(updated)
				{
					sendTextMessage(senderID,"Thank you for subscribing!"
						+" If you want to unsubscribe just type \"unsubscribe\" .");
				}
				else {
                    sendTextMessage(senderID,"Not available now! try again later!!");

				}
            },1);

		}
			break;

        case "NEWS_DAY":
		{
            userService.newsletterSettings(function (updated) {

                if(updated)
                {
                    sendTextMessage(senderID,"Thank you for subscribing!"
                        +" If you want to unsubscribe just type \"unsubscribe\" .");
                }
                else {
                    sendTextMessage(senderID,"Not available now! try again later!!");

                }
            },2);

		}
            break;
		default :	sendToApiAi(senderID, quickReplyPayload);

		break;
    }
	console.log("Quick reply for message %s with payload %s", messageId, quickReplyPayload);
	//send payload to api.ai
}

//https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-echo
function handleEcho(messageId, appId, metadata) {
	// Just logging message echoes to console
	console.log("Received echo for message %s and app %d with metadata %s", messageId, appId, metadata);
}

function handleApiAiAction(sender, action, responseText, contexts, parameters) {
	switch (action) {
		case 'confirm-order':
		{

            if(isDefined(contexts[0])&&(contexts[0].name==='confirm-order'||contexts[0].name==='confirm-order_dialog_context')&&contexts[0].parameters)
            {
                let address = (isDefined(contexts[0].parameters['address'])&&
                    contexts[0].parameters['address']!=='')?contexts[0].parameters['address']:'';
                let number = (isDefined(contexts[0].parameters['number'])&&
                    contexts[0].parameters['number']!=='')?contexts[0].parameters['number']:'';

                if(address!==''&&number!=='')
                {
                    console.log("XXXXYXXXXX "+address+" "+number);

                    confirmOrder(sender,address,number);


                }
                else {
                    sendTextMessage(sender, responseText);

                }


            }
            else {                    sendTextMessage(sender, responseText);
            }


        }
			break;
		case 'unsubscribe':
		{
            userService.newsletterSettings(function (updated) {

                if(updated)
                {
                    sendTextMessage(sender,"You are unsubscribed!!.");
                }
                else {
                    sendTextMessage(sender,"Not available now! try again later!!");

                }
            },0);
		}
			break;
		case 'buy-iphone':
		{
			colors.readUserColor(function (color) {
				let reply;
				if(color==='')
				{
					reply = "In what color would you like to have it?";
				}
				else {
                    reply = "would you like to order it in your favorite color "+color+" ?";

				}
                sendTextMessage(sender,reply);


            },sender)
		}
			break;

		case "colors.colors-favorites":
			colors.updateUserColor(parameters['color'],sender);
			let reply ="OH,I like it too, i will remeber that!!";
            sendTextMessage(sender,reply);


            break;

		case "iphone-colors":
		{
			colors.readAllColors(function (allColors) {
				let allColorString= allColors.join(',');
				let reply = 'These are the Colors available '+allColorString+'. What is your favorite color?';
				sendTextMessage(sender,reply);

            });
		}
			break;

		case "faq-delivery-time":
		{
            sendTextMessage(sender, responseText);
            sendTypingOn(sender);
            //ask what the user want to ask next

			setTimeout(function () {
				let buttons =
				[
					{ type:"phone_number",
                    title:"call",
                    payload:"+919847303065"
            		},
					{type:"web_url",
                    url:"https://www.dronelancer.in/",
                    title:"Dronerlancer"
            		},
					{type:"postback",
                    title:"KEEP ON Chatting",
                    payload:"CHAT"
            		}
				];


				sendButtonMessage(sender,"What would you like to do next?",buttons);
				
            },3000);


        }
			break;

		case "detailed-application":
		{
			if(isDefined(contexts[0])&&(contexts[0].name==='job-application'||contexts[0].name ==='job-application-details_dialog_context')&&contexts[0].parameters)
			{
				let phone = (isDefined(contexts[0].parameters['phone-number'])&&
					contexts[0].parameters['phone-number']!=='')?contexts[0].parameters['phone-number']:'';
				let username = (isDefined(contexts[0].parameters['user-name'])&&
					contexts[0].parameters['user-name']!=='')?contexts[0].parameters['user-name']:'';

                let yrsofexp = (isDefined(contexts[0].parameters['yrs-of-exp'])&&
                    contexts[0].parameters['yrs-of-exp']!=='')?contexts[0].parameters['yrs-of-exp']:'';
                let jobvacancy = (isDefined(contexts[0].parameters['job-vacancy'])&&
                    contexts[0].parameters['job-vacancy']!=='')?contexts[0].parameters['job-vacancy']:'';
                let perviousjob = (isDefined(contexts[0].parameters['pervious-job'])&&
                    contexts[0].parameters['pervious-job']!=='')?contexts[0].parameters['pervious-job']:'';

                if(phone===''&&username!==''&&yrsofexp===''&&perviousjob!=='')
				{
					let replies =[
                    {
                        "content_type":"text",
                        "title":"Less than 1 year",
                        "payload":"Less than 1 year"
                    },
					{
						"content_type":"text",
						"title":"Less than 5 year",
						"payload":"Less than 5 year"
					},
					{
						"content_type":"text",
						"title":"More than 5 year",
						"payload":"More than 5 year"
					}

                ];
					sendQuickReply(sender,responseText,replies);

				}
				else if(phone!==''&&username!==''&&yrsofexp!==''&&jobvacancy!==''&&perviousjob!=='')
				{
					let emailcontent = ' New Deatils '+ username+' '+ phone+' '+yrsofexp+' '+jobvacancy+' '+perviousjob;
					console.log("__________-_-_-_----_____"+emailcontent);
                    sendTextMessage(sender, responseText);

                }
                else {
                    sendTextMessage(sender, responseText);

                }


			}

        }
			break;

		case 'add-item':
			if(isDefined(contexts[0])&&(contexts[0].name==='add-item'||contexts[0].name==='add-item_dialog_context')&&contexts[0].parameters)
			{
                let item = (isDefined(contexts[0].parameters['food-items'])&&
                    contexts[0].parameters['food-items']!=='')?contexts[0].parameters['food-items']:'';
                let count = (isDefined(contexts[0].parameters['count'])&&
                    contexts[0].parameters['count']!=='')?contexts[0].parameters['count']:'';

                if(item!==''&&count!=='')
				{
					console.log("XXXXYXXXXX "+item+" "+count);


                    let cart = false;
                    let payload = item;
                    let  menus = soups.concat(starter.concat(friedrice.concat(noodles).concat(maincourse)));

                    for (let ke in menus) {
                        if (menus.hasOwnProperty(ke) && menus[ke].key === payload){
                            console.log("CART ITEM "+ JSON.stringify(menus[ke]));
                            cart = true;
                            menus[ke].count = count;

                            // sendToApiAi(senderID,menus[ke].key);
                            addTeam(sender,menus[ke]);
                            sendTextMessage(sender, "Added to cart !");

                        }
                    }


				}
				else {
                    sendTextMessage(sender, responseText);

                }


			}
			else {                    sendTextMessage(sender, responseText);
            }


            break;
		default:
			//unhandled action, just send back the text
			sendTextMessage(sender, responseText);
	}
}

function handleMessage(message, sender) {
	switch (message.type) {
		case 0: //text
			sendTextMessage(sender, message.speech);
			break;
		case 2: //quick replies
			let replies = [];
			for (var b = 0; b < message.replies.length; b++) {
				let reply =
				{
					"content_type": "text",
					"title": message.replies[b],
					"payload": message.replies[b]
				}
				replies.push(reply);
			}
			sendQuickReply(sender, message.title, replies);
			break;
		case 3: //image
			sendImageMessage(sender, message.imageUrl);
			break;
		case 4:
			// custom payload
			var messageData = {
				recipient: {
					id: sender
				},
				message: message.payload.facebook

			};

			callSendAPI(messageData);

			break;
	}
}


function handleCardMessages(messages, sender) {

	let elements = [];
	for (var m = 0; m < messages.length; m++) {
		let message = messages[m];
		let buttons = [];
		for (var b = 0; b < message.buttons.length; b++) {
			let isLink = (message.buttons[b].postback.substring(0, 4) === 'http');
			let button;
			if (isLink) {
				button = {
					"type": "web_url",
					"title": message.buttons[b].text,
					"url": message.buttons[b].postback
				}
			} else {
				button = {
					"type": "postback",
					"title": message.buttons[b].text,
					"payload": message.buttons[b].postback
				}
			}
			buttons.push(button);
		}


		let element = {
			"title": message.title,
			"image_url":message.imageUrl,
			"subtitle": message.subtitle,
			"buttons": buttons
		};
		elements.push(element);
	}
	sendGenericMessage(sender, elements);
}


function handleApiAiResponse(sender, response) {
	let responseText = response.result.fulfillment.speech;
	let responseData = response.result.fulfillment.data;
	let messages = response.result.fulfillment.messages;
	let action = response.result.action;
	let contexts = response.result.contexts;
	let parameters = response.result.parameters;

	sendTypingOff(sender);

	if (isDefined(messages) && (messages.length == 1 && messages[0].type != 0 || messages.length > 1)) {
		let timeoutInterval = 1100;
		let previousType ;
		let cardTypes = [];
		let timeout = 0;
		for (var i = 0; i < messages.length; i++) {

			if ( previousType == 1 && (messages[i].type != 1 || i == messages.length - 1)) {

				timeout = (i - 1) * timeoutInterval;
				setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
				cardTypes = [];
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			} else if ( messages[i].type == 1 && i == messages.length - 1) {
				cardTypes.push(messages[i]);
                		timeout = (i - 1) * timeoutInterval;
                		setTimeout(handleCardMessages.bind(null, cardTypes, sender), timeout);
                		cardTypes = [];
			} else if ( messages[i].type == 1 ) {
				cardTypes.push(messages[i]);
			} else {
				timeout = i * timeoutInterval;
				setTimeout(handleMessage.bind(null, messages[i], sender), timeout);
			}

			previousType = messages[i].type;

		}
	} else if (responseText == '' && !isDefined(action)) {
		//api ai could not evaluate input.
		console.log('Unknown query' + response.result.resolvedQuery);
		sendTextMessage(sender, "I'm not sure what you want. Can you be more specific?");
	} else if (isDefined(action)) {
		handleApiAiAction(sender, action, responseText, contexts, parameters);
	} else if (isDefined(responseData) && isDefined(responseData.facebook)) {
		try {
			console.log('Response as formatted message' + responseData.facebook);
			sendTextMessage(sender, responseData.facebook);
		} catch (err) {
			sendTextMessage(sender, err.message);
		}
	} else if (isDefined(responseText)) {

		sendTextMessage(sender, responseText);
	}
}

function sendToApiAi(sender, text) {

	console.log("sendToApiAi : "+text);

	sendTypingOn(sender);
	let apiaiRequest = apiAiService.textRequest(text, {
		sessionId: sessionIds.get(sender)
	});

	apiaiRequest.on('response', (response) => {
		if (isDefined(response.result)) {
			handleApiAiResponse(sender, response);
		}
	});

	apiaiRequest.on('error', (error) => console.error(error));
	apiaiRequest.end();
}




function sendTextMessage(recipientId, text) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text
		}
	}
	callSendAPI(messageData);
}

/*
 * Send an image using the Send API.
 *
 */
function sendImageMessage(recipientId, imageUrl) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: imageUrl
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a Gif using the Send API.
 *
 */
function sendGifMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "image",
				payload: {
					url: config.SERVER_URL + "/assets/instagram_logo.gif"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send audio using the Send API.
 *
 */
function sendAudioMessage(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "audio",
				payload: {
					url: config.SERVER_URL + "/assets/sample.mp3"
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example videoName: "/assets/allofus480.mov"
 */
function sendVideoMessage(recipientId, videoName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "video",
				payload: {
					url: config.SERVER_URL + videoName
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a video using the Send API.
 * example fileName: fileName"/assets/test.txt"
 */
function sendFileMessage(recipientId, fileName) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "file",
				payload: {
					url: config.SERVER_URL + fileName
				}
			}
		}
	};

	callSendAPI(messageData);
}



/*
 * Send a button message using the Send API.
 *
 */
function sendButtonMessage(recipientId, text, buttons) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: text,
					buttons: buttons
				}
			}
		}
	};

	callSendAPI(messageData);
}


function sendGenericMessage(recipientId, elements) {
	let noOfMessages = Math.ceil(elements.length/10);
	for(let i=0; i<noOfMessages;i++){
		let limit = (elements.length < (i*10)+9) ? elements.length: (i*10)+9 ;


        let messageData = {
            recipient: {
                id: recipientId
            },
            message: {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: elements.slice(i*10,limit)
                    }
                }
            }
        };
        console.log(" ASJN "+i +" "+JSON.stringify(messageData));

        callSendAPI(messageData);

	}

}

function sendReciept(recipientId, elements,name,time,address,totprice) {
    let messageData = {
        recipient: {
            id: recipientId
        },
        message: {
            attachment: {
                type: "template",
                payload: {
                    template_type: "receipt",
                    recipient_name:name,
                    currency:"INR",
                    payment_method:"Cash on Delivery",
                    timestamp:time,
                    address:{
                        street_1:address,
                    },
                    summary:{
                        subtotal: totprice,
						shipping_cost: 0,
                		total_tax: totprice/18,
						total_cost: totprice+(totprice/18)
        			},
                    elements: elements
                }
            }
        }
    };

    callSendAPI(messageData);
}


function sendReceiptMessage(recipientId, recipient_name, currency, payment_method,
							timestamp, elements, address, summary, adjustments) {
	// Generate a random receipt ID as the API requires a unique ID
	var receiptId = "order" + Math.floor(Math.random() * 1000);

	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "receipt",
					recipient_name: recipient_name,
					order_number: receiptId,
					currency: currency,
					payment_method: payment_method,
					timestamp: timestamp,
					elements: elements,
					address: address,
					summary: summary,
					adjustments: adjustments
				}
			}
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a message with Quick Reply buttons.
 *
 */
function sendQuickReply(recipientId, text, replies, metadata) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			text: text,
			metadata: isDefined(metadata)?metadata:'',
			quick_replies: replies
		}
	};

	callSendAPI(messageData);
}

/*
 * Send a read receipt to indicate the message has been read
 *
 */
function sendReadReceipt(recipientId) {

	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "mark_seen"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator on
 *
 */
function sendTypingOn(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_on"
	};

	callSendAPI(messageData);
}

/*
 * Turn typing indicator off
 *
 */
function sendTypingOff(recipientId) {


	var messageData = {
		recipient: {
			id: recipientId
		},
		sender_action: "typing_off"
	};

	callSendAPI(messageData);
}

/*
 * Send a message with the account linking call-to-action
 *
 */
function sendAccountLinking(recipientId) {
	var messageData = {
		recipient: {
			id: recipientId
		},
		message: {
			attachment: {
				type: "template",
				payload: {
					template_type: "button",
					text: "Welcome. Link your account.",
					buttons: [{
						type: "account_link",
						url: config.SERVER_URL + "/authorize"
          }]
				}
			}
		}
	};

	callSendAPI(messageData);
}


function addTeam(senderID,item) {
    return new Promise((resolve, reject) => {
        let newRef = cartref.child(""+senderID).push(item);
        if(newRef) {
            resolve(newRef.key());
        }
        else {
                reject("The write operation failed");
            }
        });
}

function addOrder(senderID,item,address,number) {
	orderref.child(senderID).child("address").set(address);
	orderref.child(senderID).child("number").set(number);


    return new Promise((resolve, reject) => {

        let newRef = orderref.child(senderID).push(item);
        if(newRef) {
            resolve(newRef.key());

        }
        else {
            reject("The write operation failed");
        }
    });
}
function cleanCart(senderID) {
    return new Promise((resolve1, reject1) => {
        let newRef1 = cartref.child(senderID).set(null);
        if(newRef1) {
            resolve1(newRef1.key());

        }
        else {
            reject1("The write operation failed");
        }
    });
}



function greetUserText(userId) {
	//first read user firstname

	let user = usersMap.get(userId);
    let responseText = "Welcome " + user.first_name + "!"+" What would you like to do ?";

    let replies =[
        {
            "content_type":"text",
            "title":"Menu",
            "payload":"MENU"
        },
        {
            "content_type":"text",
            "title":"Food Cart",
            "payload":"SHOPCART"
        },
        {
            "content_type":"text",
            "title":"Order Food",
            "payload":"FOODORDER"
        }

    ];
				sendQuickReply(userId,responseText,replies);



}

/*
 * Call the Send API. The message data goes in the body. If successful, we'll
 * get the message id in a response
 *
 */
function callSendAPI(messageData) {
	request({
		uri: 'https://graph.facebook.com/v2.6/me/messages',
		qs: {
			access_token: config.FB_PAGE_TOKEN
		},
		method: 'POST',
		json: messageData

	}, function (error, response, body) {
		if (!error && response.statusCode == 200) {
			var recipientId = body.recipient_id;
			var messageId = body.message_id;

			if (messageId) {
				console.log("Successfully sent message with id %s to recipient %s",
					messageId, recipientId);
			} else {
				console.log("Successfully called Send API for recipient %s",
					recipientId);
			}
		} else {
			console.error("Failed calling Send API", response.statusCode, response.statusMessage, body.error);
		}
	});
}


function sendNewsSubscribe(senderID) {
	let responseText = "I can send you specials and offers. How often would you like to recieve them?";
	let replies = [
		{
			"content_type" : "text",
			"title" : "Once a week",
			"payload":"NEWS_WEEK"},
        {
            "content_type" : "text",
            "title" : "Once a day",
            "payload":"NEWS_DAY"}
	];

	sendQuickReply(senderID,responseText,replies);



}


function showMenu(senderID) {
    //fetch menu items


    let elements = [
        {
            "title":"Soups",
            "image_url":"http://www.seriouseats.com/recipes/assets_c/2017/02/20170111-pressure-cooker-beef-barley-soup-vicky-wasik-13-thumb-1500xauto-436342.jpg",
            "subtitle":"For each mouth, a different soup!",
            "buttons":[
                {
                    "type":"postback",
                    "payload":"PAY_SOUP",
                    "title":"Soups"
                }
            ]
        },
        {
            "title":"Starters",
            "image_url":"http://digtoknow.com/wp-content/uploads/2015/09/Starter-Recipes.jpg",
            "subtitle":"Best starters in town",
            "buttons":[
                {
                    "type":"postback",
                    "payload":"PAY_STARTER",
                    "title":"Starters"
                }
            ]
        },
        {
            "title":"Noodles",
            "image_url":"http://www.ruchiskitchen.com/wp-content/uploads/2016/12/spicy-peanut-noodles-recipe-14.jpg",
            "subtitle":"Noodles are not only amusing but delicious...",
            "buttons":[
                {
                    "type":"postback",
                    "payload":"PAY_NOODLES",
                    "title":"Noodles"
                }
            ]
        },
        {
            "title":"Fried Rice",
            "image_url":"https://static01.nyt.com/images/2016/04/04/dining/04COOKING-FRIEDRICE1/04COOKING-FRIEDRICE1-superJumbo.jpg",
            "subtitle":"Keep calm and eat Fried Rice!",
            "buttons":[
                {
                    "type":"postback",
                    "payload":"PAY_FRIED_RICE",
                    "title":"Fried Rice"
                }
            ]
        },
        {
            "title":"Main Course",
            "image_url":"http://www.drgourmet.com/images/food/beefstew350.jpg",
            "subtitle":"Good food is good mood!",
            "buttons":[
                {
                    "type":"postback",
                    "payload":"PAY_MAIN_COURSE",
                    "title":"Main Course"
                }
            ]
        }
    ];

    sendGenericMessage(senderID,elements);


}

function showDIISH(senderID, payload) {
	let items;
	switch (payload){
		case 'PAY_SOUP':
			items = soups;

			break;

        case 'PAY_STARTER':
            items = starter;

            break;

        case 'PAY_NOODLES':
            items = noodles;

            break;

        case 'PAY_FRIED_RICE':
            items = friedrice;

            break;

        case 'PAY_MAIN_COURSE':
            items = maincourse;

            break;
	}

        //fetch menu items
	let elements =[];
	items.forEach(item => {
		elements.push({
            "title": item.name,
            "image_url":item.imageUrl,
            "subtitle":"Rs "+item.price,
            "buttons":[
                {
                    "type":"postback",
                    "payload":item.key,
                    "title":"Add to Cart"
                }
            ]
        })

	});



        sendGenericMessage(senderID,elements);





}

function getShoptCart(senderID) {
    let elements =[];
	let shopcartempty = true;
	let totprice = 0;
    return new Promise((resolve, reject) => {
        cartref.child(senderID).once("value", function(snapshot) {
            // do some stuff once
            snapshot.forEach(function(childSnapshot) {
                // var childKey = childSnapshot.key;
                // var childData = childSnapshot.val();
                elements.push({
                    "title": childSnapshot.val().name,
                    "image_url":childSnapshot.val().imageUrl,
                    "subtitle":"Rs "+childSnapshot.val().price +" x "+childSnapshot.val().count+" Qty"
                });
                totprice+= childSnapshot.val().price*childSnapshot.val().count;

                shopcartempty = false;
            });

            if(shopcartempty===false)
            {
                sendGenericMessage(senderID,elements);
                // sendReciept(senderID,elements,"name","time",address,totprice);

            }
            else {
                sendTextMessage(senderID,"No items in Shop Cart Yet! Go to Menu to pick items and add to cart!");

            }

            console.log("SHOP_CART : "+ JSON.stringify(elements));
        });
        if(newRef) {
            resolve(newRef.key());

        }
        else {
            reject("The write operation failed");
        }
    });



}

function confirmOrder(senderID,address,number) {


    let elements =[];
    let shopcartempty = true;
    let totprice = 0;


    return new Promise((resolve, reject) => {
        cartref.child(senderID).once("value", function(snapshot) {
            // do some stuff once
            snapshot.forEach(function(childSnapshot) {
                // var childKey = childSnapshot.key;
                // var childData = childSnapshot.val();
                elements.push({
                    "title": childSnapshot.val().name,
                    "image_url":childSnapshot.val().imageUrl,
                    "subtitle":"Rs "+childSnapshot.val().price+ " x "+childSnapshot.val().count+" Qty",
                });

                shopcartempty = false;
                totprice+=(childSnapshot.val().price *childSnapshot.val().count);
            });


            if(shopcartempty===false)
            {
                addOrder(senderID,elements,address,number);
                cleanCart(senderID);
                sendTextMessage(senderID,"Your order cost : "+totprice+" Rs");
                sendTextMessage(senderID,"Thank You For Your Order!");

            }
            else {
                sendTextMessage(senderID,"No items in Shop Cart Yet! Go to Menu to pick items and add to cart!");

            }

            console.log("SHOP_CART : "+ JSON.stringify(elements));
        });
        if(newRef) {
            resolve(newRef.key());

        }
        else {
            reject("The write operation failed");
        }
    });

}

/*
 * Postback Event
 *
 * This event is called when a postback is tapped on a Structured Message.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/postback-received
 *
 */
function receivedPostback(event) {
	let senderID = event.sender.id;
	let recipientID = event.recipient.id;
	let timeOfPostback = event.timestamp;
    setSessionAndUser(senderID);
	// The 'payload' param is a developer-defined field which is set in a postback
	// button for Structured Messages.
	let cart = false;
	let payload = event.postback.payload;
    let  menus = soups.concat(starter.concat(friedrice.concat(noodles).concat(maincourse)));
    //
    // // let result =  menus.filter(
    // //     (items) => {
    // //         return items.key === payload;
    // //     }
    // // );
    //
    // console.log(" MENU ======== "+ JSON.stringify(result));
    //
    //
    for (let ke in menus) {
        if (menus.hasOwnProperty(ke) && menus[ke].key === payload){
        	console.log("CART ITEM "+ JSON.stringify(menus[ke]));
        	cart = true;

        	sendToApiAi(senderID,menus[ke].key);
            // addTeam(senderID,menus[ke]);
			// sendTextMessage(senderID, "Added to cart !");

        }
    }

// if(!cart)
// {
	switch (payload) {



        case 'MENU':
        {
            //show menu
            showMenu(senderID);

        }
            break;


		case 'PAY_SOUP':
		{
			//show menu
			showDIISH(senderID,payload);

		}
			break;
        case 'PAY_STARTER':
        {
            //show menu
            showDIISH(senderID,payload);

        }
            break;
        case 'PAY_NOODLES':
        {
            //show menu
            showDIISH(senderID,payload);

        }
            break;
        case 'PAY_FRIED_RICE':
        {
            //show menu
            showDIISH(senderID,payload);

        }
            break;
        case 'PAY_MAIN_COURSE':
        {
            //show menu
            showDIISH(senderID,payload);

        }
            break;


		case 'SHOPCART':
		{
            getShoptCart(senderID);
			//show shopcart
		}
			break;
		case 'FOODORDER':
		{
            sendTextMessage(senderID, "Go to Menu to pick items and add to cart!");
            // start food ordering intent

        }
			break;

        case 'CONFIRMORDER':
        {
            //confirm order, clear shop cart
            // confirmOrder(senderID);
            let shopcartempty = true;
            return new Promise((resolve, reject) => {
                cartref.child(senderID).once("value", function(snapshot) {
                    // do some stuff once
                    snapshot.forEach(function(childSnapshot) {
                        shopcartempty = false;
                    });
                    if(shopcartempty===false)
                    {
                        sendToApiAi(senderID,"confirm order");
                    }
                    else {
                        sendTextMessage(senderID,"No items in Shop Cart Yet! Go to Menu to pick items and add to cart!");

                    }

                });
                if(cartref) {
                    resolve(cartref.key());

                }
                else {
                    reject("The write operation failed");
                }
            });

        }
            break;

        case 'NEWS':
        {
            sendNewsSubscribe(senderID);
        }
            break;

        case 'GET_STARTED':
        {
            greetUserText(senderID);

            // let cartRef = ref.child("cart");
            // cartRef.set({
            //     alanisawesome: {
            //         date_of_birth: "June 23, 1912",
            //         full_name: "Alan Turing"
            //     },
            //     gracehop: {
            //         date_of_birth: "December 9, 1906",
            //         full_name: "Grace Hopper"
            //     }
            // });

        }
            break;

        case 'REVIEW':
        {
            sendTextMessage(senderID, "restaurant reviews");

        }
            break;


        case 'CHAT' :
		{
			sendTextMessage(senderID,"Well i love chatting too.. do you have any more questions for me?")

		}
			break;

		default: {//unindentified payload
           if(cart===false)
		   {sendTextMessage(senderID, "I'm not sure what you want. Can you be more specific?");}
        }
			break;

	}
// }

	console.log("Received postback for user %d and page %d with payload '%s' " +
		"at %d", senderID, recipientID, payload, timeOfPostback);

}


/*
 * Message Read Event
 *
 * This event is called when a previously-sent message has been read.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-read
 *
 */
function receivedMessageRead(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	// All messages before watermark (a timestamp) or sequence have been seen.
	var watermark = event.read.watermark;
	var sequenceNumber = event.read.seq;

	console.log("Received message read event for watermark %d and sequence " +
		"number %d", watermark, sequenceNumber);
}

/*
 * Account Link Event
 *
 * This event is called when the Link Account or UnLink Account action has been
 * tapped.
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/account-linking
 *
 */
function receivedAccountLink(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;

	var status = event.account_linking.status;
	var authCode = event.account_linking.authorization_code;

	console.log("Received account link event with for user %d with status %s " +
		"and auth code %s ", senderID, status, authCode);
}

/*
 * Delivery Confirmation Event
 *
 * This event is sent to confirm the delivery of a message. Read more about
 * these fields at https://developers.facebook.com/docs/messenger-platform/webhook-reference/message-delivered
 *
 */
function receivedDeliveryConfirmation(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var delivery = event.delivery;
	var messageIDs = delivery.mids;
	var watermark = delivery.watermark;
	var sequenceNumber = delivery.seq;

	if (messageIDs) {
		messageIDs.forEach(function (messageID) {
			console.log("Received delivery confirmation for message ID: %s",
				messageID);
		});
	}

	console.log("All message before %d were delivered.", watermark);
}

/*
 * Authorization Event
 *
 * The value for 'optin.ref' is defined in the entry point. For the "Send to
 * Messenger" plugin, it is the 'data-ref' field. Read more at
 * https://developers.facebook.com/docs/messenger-platform/webhook-reference/authentication
 *
 */
function receivedAuthentication(event) {
	var senderID = event.sender.id;
	var recipientID = event.recipient.id;
	var timeOfAuth = event.timestamp;

	// The 'ref' field is set in the 'Send to Messenger' plugin, in the 'data-ref'
	// The developer can set this to an arbitrary value to associate the
	// authentication callback with the 'Send to Messenger' click event. This is
	// a way to do account linking when the user clicks the 'Send to Messenger'
	// plugin.
	var passThroughParam = event.optin.ref;

	console.log("Received authentication for user %d and page %d with pass " +
		"through param '%s' at %d", senderID, recipientID, passThroughParam,
		timeOfAuth);

	// When an authentication is received, we'll send a message back to the sender
	// to let them know it was successful.
	sendTextMessage(senderID, "Authentication successful");
}

/*
 * Verify that the callback came from Facebook. Using the App Secret from
 * the App Dashboard, we can verify the signature that is sent with each
 * callback in the x-hub-signature field, located in the header.
 *
 * https://developers.facebook.com/docs/graph-api/webhooks#setup
 *
 */
function verifyRequestSignature(req, res, buf) {
	var signature = req.headers["x-hub-signature"];

	if (!signature) {
		throw new Error('Couldn\'t validate the signature.');
	} else {
		var elements = signature.split('=');
		var method = elements[0];
		var signatureHash = elements[1];

		var expectedHash = crypto.createHmac('sha1', config.FB_APP_SECRET)
			.update(buf)
			.digest('hex');

		if (signatureHash != expectedHash) {
			throw new Error("Couldn't validate the request signature.");
		}
	}
}

function isDefined(obj) {
	if (typeof obj == 'undefined') {
		return false;
	}

	if (!obj) {
		return false;
	}

	return obj != null;
}

// Spin up the server
app.listen(app.get('port'), function () {
	console.log('running on port', app.get('port'))
})
