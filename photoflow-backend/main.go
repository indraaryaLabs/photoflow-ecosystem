package main

import (
	"fmt"
	"os"

	"photoflow-backend/app"
)

func main() {
	r := app.SetupRouter()

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	fmt.Println("🔥 Server berjalan di http://localhost:" + port)
	r.Run(":" + port)
}
