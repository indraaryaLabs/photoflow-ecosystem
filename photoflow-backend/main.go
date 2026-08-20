package main

import (
	"fmt"
	"log"
	"os"

	"photoflow-backend/app"
)

func main() {
	r, err := app.SetupRouter()
	if err != nil {
		log.Fatalf("[ERROR] Gagal menyiapkan server: %v", err)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	fmt.Println("🔥 Server berjalan di http://localhost:" + port)
	if err := r.Run(":" + port); err != nil {
		log.Fatalf("[ERROR] Server berhenti: %v", err)
	}
}
