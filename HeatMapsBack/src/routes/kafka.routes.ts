import { Router, Request, Response } from 'express';
import kafkaConsumerService from '../services/kafka.consumer.service';
import { ApiResponse, ConsumerStatusResponse } from '../types/http.types';
import { MESSAGES } from '../constants/messages';
import logger from '../utils/logger';

const router = Router();

router.post('/start', async (req: Request, res: Response) => {
    try {
        await kafkaConsumerService.start();

        const response: ApiResponse = { 
            success: true, 
            message: MESSAGES.CONSUMER.STARTED
        };

        res.json(response);
    } catch (error) {
        logger.error(MESSAGES.CONSUMER.START_ERROR, error);

        const response: ApiResponse = { 
            success: false, 
            message: MESSAGES.CONSUMER.START_ERROR,
            error: error instanceof Error ? error.message : 'Error desconocido'
        };

        res.status(500).json(response);
    }
});

router.post('/stop', async (req: Request, res: Response) => {
    try {
        await kafkaConsumerService.stop();

        const response: ApiResponse = { 
            success: true, 
            message: MESSAGES.CONSUMER.STOPPED
        };

        res.json(response);
    } catch (error) {
        logger.error(MESSAGES.CONSUMER.STOP_ERROR, error);

        const response: ApiResponse = { 
            success: false, 
            message: MESSAGES.CONSUMER.STOP_ERROR,
            error: error instanceof Error ? error.message : 'Error desconocido'
        };

        res.status(500).json(response);
    }
});

router.get('/status', (req: Request, res: Response) => {
    const isRunning = kafkaConsumerService.getStatus();

    const response: ConsumerStatusResponse = { 
        success: true,
        running: isRunning,
        status: isRunning ? 'active' : 'stopped'
    };

    res.json(response);
});

export default router;
