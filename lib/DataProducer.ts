import Logger from './Logger';
import EnhancedEventEmitter from './EnhancedEventEmitter';
import { InvalidStateError } from './errors';
import { SctpStreamParameters } from './types';

export interface DataProducerOptions {
	ordered?: boolean;
	maxPacketLifeTime?: number;
	maxRetransmits?: number;
	priority?: RTCPriorityType;
	label?: string;
	protocol?: string;
	appData?: object;
}

const logger = new Logger('DataProducer');

export class DataProducer extends EnhancedEventEmitter
{
	private _id: string;
	private _dataChannel: any;
	private _closed: boolean;
	private _sctpStreamParameters: SctpStreamParameters;
	private _appData: object;

	/**
	 * @private
	 *
	 * @emits transportclose
	 * @emits open
	 * @emits {Object} error
	 * @emits close
	 * @emits bufferedamountlow
	 * @emits @close
	 */
	constructor(
		{
			id,
			dataChannel,
			sctpStreamParameters,
			appData
		}:
		{
			id: string;
			dataChannel: any;
			sctpStreamParameters: SctpStreamParameters;
			appData: object;
		}
	)
	{
		super(logger);

		// Id.
		this._id = id;

		// The underlying RTCDataChannel instance.
		this._dataChannel = dataChannel;

		// Closed flag.
		this._closed = false;

		// SCTP stream parameters.
		this._sctpStreamParameters = sctpStreamParameters;

		// App custom data.
		this._appData = appData;

		this._handleDataChannel();
	}

	/**
	 * DataProducer id.
	 */
	get id(): string
	{
		return this._id;
	}

	/**
	 * Whether the DataProducer is closed.
	 */
	get closed(): boolean
	{
		return this._closed;
	}

	/**
	 * SCTP stream parameters.
	 */
	get sctpStreamParameters(): SctpStreamParameters
	{
		return this._sctpStreamParameters;
	}

	/**
	 * DataChannel readyState.
	 */
	get readyState(): RTCDataChannelState
	{
		return this._dataChannel.readyState;
	}

	/**
	 * DataChannel label.
	 */
	get label(): string
	{
		return this._dataChannel.label;
	}

	/**
	 * DataChannel protocol.
	 */
	get protocol(): string
	{
		return this._dataChannel.protocol;
	}

	/**
	 * DataChannel bufferedAmount.
	 */
	get bufferedAmount(): number
	{
		return this._dataChannel.bufferedAmount;
	}

	/**
	 * DataChannel bufferedAmountLowThreshold.
	 */
	get bufferedAmountLowThreshold(): number
	{
		return this._dataChannel.bufferedAmountLowThreshold;
	}

	/**
	 * Set DataChannel bufferedAmountLowThreshold.
	 *
	 * @param {Number} bufferedAmountLowThreshold
	 */
	set bufferedAmountLowThreshold(bufferedAmountLowThreshold)
	{
		this._dataChannel.bufferedAmountLowThreshold = bufferedAmountLowThreshold;
	}

	/**
	 * App custom data.
	 */
	get appData(): object
	{
		return this._appData;
	}

	/**
	 * Invalid setter.
	 */
	set appData(appData) // eslint-disable-line no-unused-vars
	{
		throw new Error('cannot override appData object');
	}

	/**
	 * Closes the DataProducer.
	 */
	close(): void
	{
		if (this._closed)
			return;

		logger.debug('close()');

		this._closed = true;

		this._dataChannel.close();

		this.emit('@close');
	}

	/**
	 * Transport was closed.
	 *
	 * @private
	 */
	transportClosed(): void
	{
		if (this._closed)
			return;

		logger.debug('transportClosed()');

		this._closed = true;

		this._dataChannel.close();

		this.safeEmit('transportclose');
	}

	/**
	 * Send a message.
	 *
	 * @param {String|Blob|ArrayBuffer|ArrayBufferView} data.
	 *
	 * @throws {InvalidStateError} if DataProducer closed.
	 * @throws {TypeError} if wrong arguments.
	 */
	send(data: any): void
	{
		logger.debug('send()');

		if (this._closed)
			throw new InvalidStateError('closed');

		this._dataChannel.send(data);
	}

	/**
	 * @private
	 */
	_handleDataChannel(): void
	{
		this._dataChannel.addEventListener('open', () =>
		{
			if (this._closed)
				return;

			logger.debug('DataChannel "open" event');

			this.safeEmit('open');
		});

		this._dataChannel.addEventListener('error', (event: any) =>
		{
			if (this._closed)
				return;

			let { error } = event;

			if (!error)
				error = new Error('unknown DataChannel error');

			if (error.errorDetail === 'sctp-failure')
			{
				logger.error(
					'DataChannel SCTP error [sctpCauseCode:%s]: %s',
					error.sctpCauseCode, error.message);
			}
			else
			{
				logger.error('DataChannel "error" event: %o', error);
			}

			this.safeEmit('error', error);
		});

		this._dataChannel.addEventListener('close', () =>
		{
			if (this._closed)
				return;

			logger.warn('DataChannel "close" event');

			this._closed = true;

			this.emit('@close');
			this.safeEmit('close');
		});

		this._dataChannel.addEventListener('message', () =>
		{
			if (this._closed)
				return;

			logger.warn(
				'DataChannel "message" event in a DataProducer, message discarded');
		});

		this._dataChannel.addEventListener('bufferedamountlow', () =>
		{
			if (this._closed)
				return;

			this.safeEmit('bufferedamountlow');
		});
	}
}