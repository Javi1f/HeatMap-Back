export interface ApiResponse<T = any> {
    success: boolean;
    message: string;
    data?: T;
    error?: string;
}

export interface ConsumerStatusResponse {
    success: boolean;
    running: boolean;
    status: 'active' | 'stopped';
}
