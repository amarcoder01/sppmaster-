import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react({
    babel: {
      plugins: [
        '@babel/plugin-syntax-decimal'
      ]
    }
  })],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  // Define global variables to fix crypto issues
  define: {
    global: 'globalThis',
  },
  // Worker configuration to fix crypto.hash issues
  worker: {
    format: 'iife',
    plugins: () => []
  },
  // Ensure build doesn't hang by setting explicit timeouts
  build: {
    // Set a timeout for the build process (in milliseconds)
    // This ensures the build doesn't hang indefinitely
    chunkSizeWarningLimit: 1000,
    target: 'es2020',
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          ui: ['framer-motion', 'react-hot-toast'],
          charts: ['recharts'],
          pdf: ['jspdf', 'jspdf-autotable', 'html2canvas']
        }
      }
    }
  },
});
