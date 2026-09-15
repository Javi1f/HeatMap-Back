import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: false,
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            // Se mide todo `src`, se haya importado en alguna prueba o no: sin
            // `include`, un archivo que ninguna prueba toca no aparece en el
            // informe y la cobertura parece mayor de lo que es.
            include: ['src/**/*.ts'],
            exclude: ['dist', 'node_modules', 'tests', 'src/**/*.d.ts'],
        },
    },
});
