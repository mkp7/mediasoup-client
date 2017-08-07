'use strict';

import Logger from './Logger';
import EnhancedEventEmitter from './EnhancedEventEmitter';
import * as utils from './utils';
import Device from './Device';
import CommandQueue from './CommandQueue';

const logger = new Logger('Transport');

export default class Transport extends EnhancedEventEmitter
{
	/**
	 * @emits {state: String} connectionstatechange
	 * @emits {originator: String, [appData]: Any} closed
	 * @emits {method: String, [data]: Object, callback: Function, errback: Function} @request
	 * @emits {method: String, [data]: Object} @notify
	 * @emits {originator: String} @close
	 */
	constructor(direction, extendedRtpCapabilities, settings, appData)
	{
		logger.debug('constructor() [direction:%s, extendedRtpCapabilities:%o]',
			direction, extendedRtpCapabilities);

		super();

		// Id.
		// @type {Number}
		this._id = utils.randomNumber();

		// Closed flag.
		// @type {Boolean}
		this._closed = false;

		// Direction.
		// @type {String}
		this._direction = direction;

		// Room settings.
		// @type {Object}
		this._settings = settings;

		// App custom data.
		// @type {Any}
		this._appData = appData;

		// Map of Senders indexed by id.
		// @type {map<Number, Sender>}
		this._senders = new Map();

		// Map of Receivers indexed by id.
		// @type {map<Number, Receiver>}
		this._receivers = new Map();

		// Commands handler.
		// @type {CommandQueue}
		this._commandQueue = new CommandQueue();

		// Device specific handler.
		this._handler = new Device.Handler(direction, extendedRtpCapabilities, settings);

		// Transport state. Values can be:
		// 'new'/'connecting'/'connected'/'failed'/'disconnected'/'closed'
		// @type {String}
		this._connectionState = 'new';

		this._commandQueue.on('exec', this._execCommand.bind(this));
		this._handleHandler();
	}

	/**
	 * Transport id.
	 *
	 * @return {Number}
	 */
	get id()
	{
		return this._id;
	}

	/**
	 * Whether the Transport is closed.
	 *
	 * @return {Boolean}
	 */
	get closed()
	{
		return this._closed;
	}

	/**
	 * Transport direction.
	 *
	 * @return {String}
	 */
	get direction()
	{
		return this._direction;
	}

	/**
	 * App custom data.
	 *
	 * @return {Any}
	 */
	get appData()
	{
		return this._appData;
	}

	/**
	 * Connection state.
	 *
	 * @return {String}
	 */
	get connectionState()
	{
		return this._connectionState;
	}

	/**
	 * Close the Transport.
	 *
	 * @param {Any} [appData] - App custom data.
	 */
	close(appData)
	{
		logger.debug('close()');

		if (this._closed)
			return;

		this._closed = true;

		this.safeEmit(
			'@notify', 'closeTransport', { id: this._id, appData });

		this.emit('@close', 'local');
		this.safeEmit('closed', 'local', appData);

		this.destroy();
	}

	/**
	 * My remote Transport was closed.
	 * Invoked via remote notification.
	 *
	 * @param {Any} [appData] - App custom data.
	 */
	remoteClose(appData)
	{
		logger.debug('remoteClose()');

		if (this._closed)
			return;

		this._closed = true;

		this.emit('@close', 'remote');
		this.safeEmit('closed', 'remote', appData);

		this.destroy();
	}

	/**
	 * Destroys the Transport.
	 */
	destroy()
	{
		// Close the CommandQueue.
		this._commandQueue.close();

		// Close the handler.
		this._handler.close();

		// Unhandle all the Senders.
		for (let sender of this._senders.values())
		{
			sender.setHandled(false);
		}

		// Unhandle all the Receivers.
		for (let receiver of this._receivers.values())
		{
			receiver.setHandled(false);
		}
	}

	/**
	 * Send the given Sender over this Transport.
	 *
	 * @param {Sender} sender
	 *
	 * @example
	 * transport.send(videoSender)
	 *   .then(() => {
	 *     // Done
	 *   });
	 */
	send(sender)
	{
		logger.debug('send() [sender:%o]', sender);

		if (this._direction !== 'send')
			return Promise.reject(new Error('cannot send on a receiving Transport'));
		else if (!sender || sender.klass !== 'Sender')
			return Promise.reject(new TypeError('wrong Sender'));

		// Enqueue command.
		return this._commandQueue.push('addSender', { sender });
	}

	/**
	 * Receive the given Receiver over this Transport.
	 *
	 * @param {Receiver} receiver
	 *
	 * @example
	 * transport.receive(aliceVideoReceiver)
	 *   .then(() => {
	 *     // Done
	 *   });
	 */
	receive(receiver)
	{
		logger.debug('receive() [receiver:%o]', receiver);

		if (this._direction !== 'recv')
			return Promise.reject(new Error('cannot receive on a sending Transport'));
		else if (!receiver || receiver.klass !== 'Receiver')
			return Promise.reject(new TypeError('wrong Receiver'));

		// Enqueue command.
		return this._commandQueue.push('addReceiver', { receiver });
	}

	_handleHandler()
	{
		const handler = this._handler;

		handler.on('@connectionstatechange', (state) =>
		{
			if (this._connectionState === state)
				return;

			this._connectionState = state;

			if (!this._closed)
				this.safeEmit('connectionstatechange', state);
		});

		handler.on(
			'@needcreatetransport',
			(transportLocalParameters, callback, errback) =>
			{
				const data =
				{
					id      : this._id,
					options : this._settings.transportOptions,
					appData : this._appData
				};

				if (transportLocalParameters)
					data.dtlsParameters = transportLocalParameters.dtlsParameters;

				this.safeEmit('@request', 'createTransport', data, callback, errback);
			});

		handler.on('@needupdatetransport', (transportLocalParameters) =>
		{
			const data =
			{
				id             : this._id,
				dtlsParameters : transportLocalParameters.dtlsParameters
			};

			this.safeEmit('@notify', 'updateTransport', data);
		});
	}

	_execCommand(command, promiseHolder)
	{
		logger.debug('_execCommand() [method:%s]', command.method);

		let promise;

		try
		{
			switch (command.method)
			{
				case 'addSender':
				{
					const { sender } = command;

					promise = this._execAddSender(sender);
					break;
				}

				case 'removeSender':
				{
					const { sender } = command;

					promise = this._execRemoveSender(sender);
					break;
				}

				case 'addReceiver':
				{
					const { receiver } = command;

					promise = this._execAddReceiver(receiver);
					break;
				}

				case 'removeReceiver':
				{
					const { receiver } = command;

					promise = this._execRemoveReceiver(receiver);
					break;
				}

				default:
				{
					promise = Promise.reject(
						new Error(`unknown command method "${command.method}"`));
				}
			}
		}
		catch (error)
		{
			promise = Promise.reject(error);
		}

		// Fill the given Promise holder.
		promiseHolder.promise = promise;
	}

	_execAddSender(sender)
	{
		logger.debug('_execAddSender()');

		if (sender.closed)
			return Promise.reject(new Error('Sender closed'));
		else if (sender.handled)
			return Promise.reject(new Error('Sender already handled by a Transport'));

		let sendRtpParameters;

		sender.setHandled('tmp');

		// Call the handler.
		return Promise.resolve()
			.then(() =>
			{
				return this._handler.addSender(sender);
			})
			.then((rtpParameters) =>
			{
				const data =
				{
					id            : sender.id,
					kind          : sender.kind,
					transportId   : this._id,
					rtpParameters : rtpParameters,
					paused        : sender.locallyPaused,
					appData       : sender.appData
				};

				return this.safeEmitAsPromise('@request', 'createReceiver', data);
			})
			.then(() =>
			{
				sender.setHandled(true, sendRtpParameters);
				this._senders.set(sender.id, sender);
				this._handleSender(sender);
			})
			.catch((error) =>
			{
				sender.setHandled(false);

				throw error;
			});
	}

	_execRemoveSender(sender)
	{
		logger.debug('_execRemoveSender()');

		// Call the handler.
		return this._handler.removeSender(sender);
	}

	_execAddReceiver(receiver)
	{
		logger.debug('_execAddReceiver()');

		if (receiver.closed)
			return Promise.reject(new Error('Receiver closed'));
		else if (receiver.handled)
			return Promise.reject(new Error('Receiver already handled by a Transport'));

		// Check whether we can receive this Receiver.
		if (!receiver.supported)
		{
			return Promise.reject(
				new Error('cannot receive this Receiver, unsupported codecs'));
		}

		let recvTrack;

		receiver.setHandled('tmp');

		// Call the handler.
		return Promise.resolve()
			.then(() =>
			{
				return this._handler.addReceiver(receiver);
			})
			.then((track) =>
			{
				recvTrack = track;

				const data =
				{
					id          : receiver.id,
					rtpSettings : receiver.rtpSettings
				};

				return this.safeEmitAsPromise('@request', 'enableSender', data);
			})
			.then(() =>
			{
				receiver.setHandled(true, recvTrack);
				this._receivers.set(receiver.id, receiver);
				this._handleReceiver(receiver);

				return recvTrack;
			})
			.catch((error) =>
			{
				receiver.setHandled(false);

				throw error;
			});
	}

	_execRemoveReceiver(receiver)
	{
		logger.debug('_execRemoveReceiver()');

		// Call the handler.
		return this._handler.removeReceiver(receiver);
	}

	_handleSender(sender)
	{
		sender.on('@close', (originator, appData) =>
		{
			this._senders.delete(sender.id);

			// Enqueue command.
			this._commandQueue.push('removeSender', { sender })
				.catch(() => {});

			if (originator === 'local')
			{
				this.safeEmit(
					'@notify', 'closeReceiver', { id: sender.id, appData });
			}
		});

		sender.on('@pause', (appData) =>
		{
			const data =
			{
				id      : sender.id,
				appData : appData
			};

			this.safeEmit('@notify', 'pauseReceiver', data);
		});

		sender.on('@resume', (appData) =>
		{
			const data =
			{
				id      : sender.id,
				appData : appData
			};

			this.safeEmit('@notify', 'resumeReceiver', data);
		});
	}

	_handleReceiver(receiver)
	{
		receiver.on('@close', () =>
		{
			this._receivers.delete(receiver.id);

			// Enqueue command.
			this._commandQueue.push('removeReceiver', { receiver })
				.catch(() => {});
		});

		receiver.on('@pause', (appData) =>
		{
			const data =
			{
				id      : receiver.id,
				appData : appData
			};

			this.safeEmit('@notify', 'pauseSender', data);
		});

		receiver.on('@resume', (appData) =>
		{
			const data =
			{
				id      : receiver.id,
				appData : appData
			};

			this.safeEmit('@notify', 'resumeSender', data);
		});
	}
}