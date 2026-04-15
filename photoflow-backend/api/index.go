package api

import (
	"net/http"

	"photoflow-backend/app"
)

var ginApp http.Handler

func init() {
	ginApp = app.SetupRouter()
}

// Handler adalah entry point mutlak untuk Vercel Serverless
func Handler(w http.ResponseWriter, r *http.Request) {
	ginApp.ServeHTTP(w, r)
}
