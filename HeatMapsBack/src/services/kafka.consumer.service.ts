import { Kafka, Consumer, EachMessagePayload } from 'kafkajs';
import { BOOTSTRAP_SERVERS, KAFKA_TOPIC, KAFKA_GROUP_ID, getSSLConfig } from '../config/kafka.config';
import { decrypt } from '../utils/crypto.util';
import { SensorPayload, ProcessedSensorData } from '../types/sensor.types';
import { emitSensorData } from '../config/socket.config';
import logger from '../utils/logger';
import { MESSAGES } from '../constants/messages';
import dataProcessorService from './data-processor.service';

class KafkaConsumerService {
    private kafka: Kafka | null = null;
    private consumer: Consumer | null = null;
    private isRunning = false;

    private initKafka(): void {
        if (this.kafka) return;

        const sslConfig = getSSLConfig();
        this.kafka = new Kafka({
            clientId: 'sensor-consumer',
            brokers: BOOTSTRAP_SERVERS,
            ssl: sslConfig.ssl
        });
    }

    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn(MESSAGES.CONSUMER.ALREADY_RUNNING);
            return;
        }

        try {
            this.initKafka();

            if (!this.kafka) {
                throw new Error('Kafka no está inicializado');
            }

            this.consumer = this.kafka.consumer({ groupId: KAFKA_GROUP_ID });

            await this.consumer.connect();
            await this.consumer.subscribe({ topic: KAFKA_TOPIC, fromBeginning: false });

            await this.consumer.run({
                eachMessage: async (payload: EachMessagePayload) => {
                    await this.handleMessage(payload);
                }
            });

            this.isRunning = true;
        } catch (error) {
            logger.error(MESSAGES.CONSUMER.START_ERROR, error);
            throw error;
        }
    }

    private async handleMessage({ message }: EachMessagePayload): Promise<void> {
        try {
            if (!message.value) {
                logger.warn(MESSAGES.KAFKA.EMPTY_MESSAGE);
                return;
            }

            const data: SensorPayload = decrypt(message.value);

            const processedData: ProcessedSensorData = this.processData(data, message.value.length);

            logger.info(`${MESSAGES.KAFKA.DATA_RECEIVED}: Sensor ${processedData.sensor_id} | ${processedData.total_devices} dispositivos`);

            await dataProcessorService.processAndSave(processedData);

            emitSensorData(processedData);

            logger.debug(MESSAGES.KAFKA.DATA_SENT);

        } catch (error) {
            logger.error(MESSAGES.KAFKA.DECRYPT_ERROR, error);
        }
    }

    private processData(data: SensorPayload, bytesReceived: number): ProcessedSensorData {
        return {
            sensor_id: data.sensor_id || '?',
            total_devices: data.total_devices || 0,
            timestamp: new Date(data.timestamp * 1000).toLocaleTimeString('es-ES'),
            timestamp_raw: data.timestamp,
            bytes_received: bytesReceived,
            devices: data.devices || [],
            received_at: new Date().toISOString()
        };
    }

    async stop(): Promise<void> {
        if (!this.isRunning || !this.consumer) {
            logger.warn(MESSAGES.CONSUMER.NOT_RUNNING);
            return;
        }

        try {
            await this.consumer.disconnect();
            this.isRunning = false;
            this.consumer = null;
            logger.info(MESSAGES.CONSUMER.STOPPED);
        } catch (error) {
            logger.error(MESSAGES.CONSUMER.STOP_ERROR, error);
            throw error;
        }
    }

    getStatus(): boolean {
        return this.isRunning;
    }
}

export default new KafkaConsumerService();
