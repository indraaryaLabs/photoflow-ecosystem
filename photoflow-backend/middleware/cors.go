package middleware

import "github.com/gin-gonic/gin"

// CORS mengizinkan hanya origin yang terdaftar.
func CORS() gin.HandlerFunc {
	// Daftar origin yang diizinkan (Production + Local Dev)
	allowedOrigins := map[string]bool{
		"https://photoflow-ecosystem.vercel.app": true,
		"http://localhost:5173":                  true, // Vite dev server
	}

	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		if allowedOrigins[origin] {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}

		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With, ngrok-skip-browser-warning")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")
		c.Writer.Header().Set("Vary", "Origin")

		// Tangani Preflight Request
		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}
