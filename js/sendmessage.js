/* vim: ts=4:sw=4:expandtab
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
// sendMessage(numbers = [], message = PushMessageContentProto, callback(success/failure map))
window.textsecure.messaging = function() {
	'use strict';

	var self = {};

	function getKeysForNumber(number, updateDevices) {
		var handleResult = function(response) {
			for (var i in response.devices) {
				if (updateDevices === undefined || updateDevices.indexOf(response.devices[i].deviceId) > -1)
					textsecure.storage.devices.saveKeysToDeviceObject({
						encodedNumber: number + "." + response.devices[i].deviceId,
						identityKey: response.identityKey,
						preKey: response.devices[i].preKey.publicKey,
						preKeyId: response.devices[i].preKey.keyId,
						signedKey: response.devices[i].signedPreKey.publicKey,
						signedKeyId: response.devices[i].signedPreKey.keyId,
						registrationId: response.devices[i].registrationId
					});
			}
		};

		var promises = [];
		if (updateDevices !== undefined)
			for (var i in updateDevices)
				promises[promises.length] = textsecure.api.getKeysForNumber(number, updateDevices[i]).then(handleResult);
		else
			return textsecure.api.getKeysForNumber(number).then(handleResult);

		return Promise.all(promises);
	}

	// success_callback(server success/failure map), error_callback(error_msg)
	// message == PushMessageContentProto (NOT STRING)
	function sendMessageToDevices(timestamp, number, deviceObjectList, message, success_callback, error_callback) {
		var jsonData = [];
		var relay = undefined;
		var promises = [];

		var addEncryptionFor = function(i) {
			if (deviceObjectList[i].relay !== undefined) {
				if (relay === undefined)
					relay = deviceObjectList[i].relay;
				else if (relay != deviceObjectList[i].relay)
					return new Promise(function() { throw new Error("Mismatched relays for number " + number); });
			} else {
				if (relay === undefined)
					relay = "";
				else if (relay != "")
					return new Promise(function() { throw new Error("Mismatched relays for number " + number); });
			}

			return textsecure.protocol.encryptMessageFor(deviceObjectList[i], message).then(function(encryptedMsg) {
				jsonData[i] = {
					type: encryptedMsg.type,
					destinationDeviceId: textsecure.utils.unencodeNumber(deviceObjectList[i].encodedNumber)[1],
					destinationRegistrationId: deviceObjectList[i].registrationId,
					body: encryptedMsg.body,
					timestamp: timestamp
				};

				if (deviceObjectList[i].relay !== undefined)
					jsonData[i].relay = deviceObjectList[i].relay;
			});
		}

		for (var i = 0; i < deviceObjectList.length; i++)
			promises[i] = addEncryptionFor(i);
		return Promise.all(promises).then(function() {
			return textsecure.api.sendMessages(number, jsonData);
		});
	}

	var sendGroupProto;
	var makeAttachmentPointer;
	var refreshGroups = function(number) {
		var groups = textsecure.storage.groups.getGroupListForNumber(number);
		var promises = [];
		for (var i in groups) {
			var group = textsecure.storage.groups.getGroup(groups[i]);

			var proto = new textsecure.protobuf.PushMessageContent();
			proto.group = new textsecure.protobuf.PushMessageContent.GroupContext();

			proto.group.id = toArrayBuffer(group.id);
			proto.group.type = textsecure.protobuf.PushMessageContent.GroupContext.Type.UPDATE;
			proto.group.members = group.numbers;
			proto.group.name = group.name === undefined ? null : group.name;

			if (group.avatar !== undefined) {
				return makeAttachmentPointer(group.avatar).then(function(attachment) {
					proto.group.avatar = attachment;
					promises.push(sendGroupProto([number], proto));
				});
			} else {
				promises.push(sendGroupProto([number], proto));
			}
		}
		return Promise.all(promises);
	}

	var tryMessageAgain = function(number, encodedMessage, message_id) {
        var message = new Whisper.MessageCollection().add({id: message_id});
        message.fetch().then(function() {
            textsecure.storage.removeEncrypted("devices" + number);
            refreshGroups(number).then(function() {
                var proto = textsecure.protobuf.PushMessageContent.decode(encodedMessage, 'binary');
                sendMessageProto([number], proto, function(res) {
                    if (res.failure.length > 0) {
                        message.set('errors', []);
                    }
                    else {
                        message.set('errors', res.failures);
                    }
                    message.save().then(function(){
                        extension.trigger('message', message); // notify frontend listeners
                    });
                });
            });
        });
	};
	textsecure.replay.registerFunction(tryMessageAgain, textsecure.replay.Type.SEND_MESSAGE);

	var sendMessageProto = function(timestamp, numbers, message, callback) {
		var numbersCompleted = 0;
		var errors = [];
		var successfulNumbers = [];

		var numberCompleted = function() {
			numbersCompleted++;
			if (numbersCompleted >= numbers.length)
				callback({success: successfulNumbers, failure: errors});
		}

		var registerError = function(number, message, error) {
			if (error) {
				if (error.humanError)
					message = error.humanError;
			} else
				error = new Error(message);
			errors[errors.length] = { number: number, reason: message, error: error };
			numberCompleted();
		}

		var doSendMessage;
		var reloadDevicesAndSend = function(number, recurse) {
			return function() {
				var devicesForNumber = textsecure.storage.devices.getDeviceObjectsForNumber(number);
				if (devicesForNumber.length == 0)
					return registerError(number, "Got empty device list when loading device keys", null);
				refreshGroups(number).then(function() {
					doSendMessage(number, devicesForNumber, recurse);
				});
			}
		}

		doSendMessage = function(number, devicesForNumber, recurse) {
			return sendMessageToDevices(timestamp, number, devicesForNumber, message).then(function(result) {
				successfulNumbers[successfulNumbers.length] = number;
				numberCompleted();
			}).catch(function(error) {
				if (error instanceof Error && error.name == "HTTPError" && (error.message == 410 || error.message == 409)) {
					if (!recurse)
						return registerError(number, "Hit retry limit attempting to reload device list", error);

					if (error.message == 409)
						textsecure.storage.devices.removeDeviceIdsForNumber(number, error.response.extraDevices);

					var resetDevices = ((error.message == 410) ? error.response.staleDevices : error.response.missingDevices);
					getKeysForNumber(number, resetDevices)
						.then(reloadDevicesAndSend(number, false))
						.catch(function(error) {
							if (error.message !== "Identity key changed")
								registerError(number, "Failed to reload device keys", error);
							else {
                                error = new textsecure.OutgoingIdentityKeyError(number, getString(message.encode()));
								registerError(number, "Identity key changed", error);
							}
						});
				} else
					registerError(number, "Failed to create or send message", error);
			});
		}

    _.each(numbers, function(number) {
			var devicesForNumber = textsecure.storage.devices.getDeviceObjectsForNumber(number);

			var promises = [];
			for (var j in devicesForNumber)
				if (devicesForNumber[j].registrationId === undefined)
					promises[promises.length] = getKeysForNumber(number, [parseInt(textsecure.utils.unencodeNumber(devicesForNumber[j].encodedNumber)[1])]);

			Promise.all(promises).then(function() {
				devicesForNumber = textsecure.storage.devices.getDeviceObjectsForNumber(number);

				if (devicesForNumber.length == 0) {
					getKeysForNumber(number)
						.then(reloadDevicesAndSend(number, true))
						.catch(function(error) {
							registerError(number, "Failed to retreive new device keys for number " + number, error);
						});
				} else
					doSendMessage(number, devicesForNumber, true);
			});
		});
	}

	makeAttachmentPointer = function(attachment) {
		var proto = new textsecure.protobuf.PushMessageContent.AttachmentPointer();
		proto.key = textsecure.crypto.getRandomBytes(64);

		var iv = textsecure.crypto.getRandomBytes(16);
		return textsecure.protocol.encryptAttachment(attachment.data, proto.key, iv).then(function(encryptedBin) {
			return textsecure.api.putAttachment(encryptedBin).then(function(id) {
				proto.id = id;
				proto.contentType = attachment.contentType;
				return proto;
			});
		});
	}

	var sendIndividualProto = function(number, proto, timestamp) {
		return new Promise(function(resolve, reject) {
			sendMessageProto(timestamp, [number], proto, function(res) {
				if (res.failure.length > 0)
					reject(res.failure[0].error);
				else
					resolve();
			});
		});
	}

	sendGroupProto = function(numbers, proto, timestamp) {
        timestamp = timestamp || Date.now();
		var me = textsecure.utils.unencodeNumber(textsecure.storage.getUnencrypted("number_id"))[0];
		numbers = numbers.filter(function(number) { return number != me; });

		return new Promise(function(resolve, reject) {
			sendMessageProto(timestamp, numbers, proto, function(res) {
				if (res.failure.length > 0)
					reject(res.failure);
				else
					resolve();
			});
		});
	}

	self.sendMessageToNumber = function(number, messageText, attachments, timestamp) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.body = messageText;

		var promises = [];
		for (var i in attachments)
			promises.push(makeAttachmentPointer(attachments[i]));
		return Promise.all(promises).then(function(attachmentsArray) {
			proto.attachments = attachmentsArray;
			return sendIndividualProto(number, proto, timestamp);
		});
	}

	self.closeSession = function(number) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.body = "TERMINATE";
		proto.flags = textsecure.protobuf.PushMessageContent.Flags.END_SESSION;
		return sendIndividualProto(number, proto).then(function(res) {
			var devices = textsecure.storage.devices.getDeviceObjectsForNumber(number);
			for (var i in devices)
				textsecure.protocol.closeOpenSessionForDevice(devices[i].encodedNumber);

			return res;
		});
	}

	self.sendMessageToGroup = function(groupId, messageText, attachments, timestamp) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.body = messageText;
		proto.group = new textsecure.protobuf.PushMessageContent.GroupContext();
		proto.group.id = toArrayBuffer(groupId);
		proto.group.type = textsecure.protobuf.PushMessageContent.GroupContext.Type.DELIVER;

		var numbers = textsecure.storage.groups.getNumbers(groupId);
		if (numbers === undefined)
			return new Promise(function(resolve, reject) { reject(new Error("Unknown Group")); });

		var promises = [];
		for (var i in attachments)
			promises.push(makeAttachmentPointer(attachments[i]));
		return Promise.all(promises).then(function(attachmentsArray) {
			proto.attachments = attachmentsArray;
			return sendGroupProto(numbers, proto, timestamp);
		});
	}

	self.createGroup = function(numbers, name, avatar) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.group = new textsecure.protobuf.PushMessageContent.GroupContext();

		var group = textsecure.storage.groups.createNewGroup(numbers);
		proto.group.id = toArrayBuffer(group.id);
		var numbers = group.numbers;

		proto.group.type = textsecure.protobuf.PushMessageContent.GroupContext.Type.UPDATE;
		proto.group.members = numbers;
		proto.group.name = name;

		if (avatar !== undefined) {
			return makeAttachmentPointer(avatar).then(function(attachment) {
				proto.group.avatar = attachment;
				return sendGroupProto(numbers, proto).then(function() {
					return proto.group.id;
				});
			});
		} else {
			return sendGroupProto(numbers, proto).then(function() {
				return proto.group.id;
			});
		}
	}

	self.addNumberToGroup = function(groupId, number) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.group = new textsecure.protobuf.PushMessageContent.GroupContext();
		proto.group.id = toArrayBuffer(groupId);
		proto.group.type = textsecure.protobuf.PushMessageContent.GroupContext.Type.UPDATE;

		var numbers = textsecure.storage.groups.addNumbers(groupId, [number]);
		if (numbers === undefined)
			return new Promise(function(resolve, reject) { reject(new Error("Unknown Group")); });
		proto.group.members = numbers;

		return sendGroupProto(numbers, proto);
	}

	self.setGroupName = function(groupId, name) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.group = new textsecure.protobuf.PushMessageContent.GroupContext();
		proto.group.id = toArrayBuffer(groupId);
		proto.group.type = textsecure.protobuf.PushMessageContent.GroupContext.Type.UPDATE;
		proto.group.name = name;

		var numbers = textsecure.storage.groups.getNumbers(groupId);
		if (numbers === undefined)
			return new Promise(function(resolve, reject) { reject(new Error("Unknown Group")); });
		proto.group.members = numbers;

		return sendGroupProto(numbers, proto);
	}

	self.setGroupAvatar = function(groupId, avatar) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.group = new textsecure.protobuf.PushMessageContent.GroupContext();
		proto.group.id = toArrayBuffer(groupId);
		proto.group.type = textsecure.protobuf.PushMessageContent.GroupContext.Type.UPDATE;

		var numbers = textsecure.storage.groups.getNumbers(groupId);
		if (numbers === undefined)
			return new Promise(function(resolve, reject) { reject(new Error("Unknown Group")); });
		proto.group.members = numbers;

		return makeAttachmentPointer(avatar).then(function(attachment) {
			proto.group.avatar = attachment;
			return sendGroupProto(numbers, proto);
		});
	}

	self.leaveGroup = function(groupId) {
		var proto = new textsecure.protobuf.PushMessageContent();
		proto.group = new textsecure.protobuf.PushMessageContent.GroupContext();
		proto.group.id = toArrayBuffer(groupId);
		proto.group.type = textsecure.protobuf.PushMessageContent.GroupContext.Type.QUIT;

		var numbers = textsecure.storage.groups.getNumbers(groupId);
		if (numbers === undefined)
			return new Promise(function(resolve, reject) { reject(new Error("Unknown Group")); });
		textsecure.storage.groups.deleteGroup(groupId);

		return sendGroupProto(numbers, proto);
	}

	return self;
}();
