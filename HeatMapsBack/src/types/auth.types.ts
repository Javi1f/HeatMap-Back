export interface JwtPayload {
    id: number;
    username: string;
    email: string;
}

export interface LoginRequest {
    username: string;
    password: string;
}

export interface RegisterRequest {
    username: string;
    email: string;
    password: string;
}

export interface VerifyCodeRequest {
    email: string;
    code: string;
}