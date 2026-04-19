package aiclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// Client talks to the Python AI service.
type Client struct {
	baseURL    string
	httpClient *http.Client
}

// New returns a Client targeting baseURL.
func New(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 20 * time.Second,
		},
	}
}

type chatRequest struct {
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
}

type chatResponse struct {
	Reply string `json:"reply"`
}

// TriggerFAQEmbed asks the AI service to re-embed all published FAQs.
// It is fire-and-forget: the gateway calls it in a goroutine after FAQ writes
// so embeddings stay fresh without blocking the admin response.
// Failures are logged but not propagated.
func (c *Client) TriggerFAQEmbed(log func(msg string, args ...any)) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/internal/embed-faqs", nil)
	if err != nil {
		log("aiclient: build embed-faqs request", "err", err)
		return
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		log("aiclient: trigger embed-faqs", "err", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log("aiclient: embed-faqs unexpected status", "status", resp.StatusCode)
	}
}

// Chat sends a message to the AI service and returns its reply.
func (c *Client) Chat(ctx context.Context, sessionID, message string) (string, error) {
	reqBody, err := json.Marshal(chatRequest{SessionID: sessionID, Message: message})
	if err != nil {
		return "", fmt.Errorf("aiclient: marshal request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/chat", bytes.NewReader(reqBody))
	if err != nil {
		return "", fmt.Errorf("aiclient: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("aiclient: do request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("aiclient: unexpected status %d", resp.StatusCode)
	}

	var out chatResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&out); err != nil {
		return "", fmt.Errorf("aiclient: decode response: %w", err)
	}

	return out.Reply, nil
}
