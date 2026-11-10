// Command stt-healthcheck probes the local Parakeet server for the container
// HEALTHCHECK. The runtime image ships no curl or wget.
package main

import (
	"net/http"
	"os"
	"time"
)

func main() {
	port := os.Getenv("PARAKEET_PORT")
	if port == "" {
		port = "5092"
	}
	client := http.Client{Timeout: 4 * time.Second}
	resp, err := client.Get("http://127.0.0.1:" + port + "/health")
	if err != nil {
		os.Exit(1)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		os.Exit(1)
	}
}
