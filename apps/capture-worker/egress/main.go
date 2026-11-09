// Voxen capture-worker egress proxy.
//
// This replaces Smokescreen's upstream main.go at build time. It runs the
// unmodified Smokescreen library with its CLI flags and adds one policy the CLI
// lacks: only destination ports listed in SMOKESCREEN_ALLOWED_PORTS (default
// "80,443") are allowed. There is no egress ACL file, so every public
// destination is allowed; private, loopback, link-local and other non-global
// ranges are denied by Smokescreen defaults plus --deny-range flags.
package main

import (
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/sirupsen/logrus"
	"github.com/stripe/smokescreen/cmd"
	"github.com/stripe/smokescreen/pkg/smokescreen"
)

func allowedPorts() map[int]bool {
	raw := os.Getenv("SMOKESCREEN_ALLOWED_PORTS")
	if raw == "" {
		raw = "80,443"
	}
	ports := map[int]bool{}
	for _, item := range strings.Split(raw, ",") {
		port, err := strconv.Atoi(strings.TrimSpace(item))
		if err != nil || port <= 0 || port > 65535 {
			logrus.Fatalf("invalid SMOKESCREEN_ALLOWED_PORTS entry %q", item)
		}
		ports[port] = true
	}
	return ports
}

func destinationPort(req *http.Request) (int, error) {
	host := req.Host
	if req.Method != http.MethodConnect && req.URL != nil && req.URL.Host != "" {
		host = req.URL.Host
	}
	if _, portText, err := net.SplitHostPort(host); err == nil {
		return strconv.Atoi(portText)
	}
	if req.Method == http.MethodConnect {
		return 0, fmt.Errorf("CONNECT without port")
	}
	if req.URL != nil && req.URL.Scheme == "https" {
		return 443, nil
	}
	return 80, nil
}

func main() {
	ports := allowedPorts()
	conf, err := cmd.NewConfiguration(nil, nil)
	if err != nil {
		logrus.Fatalf("Could not create configuration: %v", err)
	}
	if conf == nil {
		return // --help or --version handled by NewConfiguration
	}
	conf.RoleFromRequest = func(req *http.Request) (string, error) {
		return "", smokescreen.MissingRoleError("roles are not used")
	}
	conf.AllowMissingRole = true
	conf.PostDecisionRequestHandler = func(req *http.Request) error {
		port, err := destinationPort(req)
		if err != nil {
			return err
		}
		if !ports[port] {
			return fmt.Errorf("destination port %d is not allowed", port)
		}
		return nil
	}
	conf.Log.Formatter = &logrus.JSONFormatter{}
	log.SetOutput(&smokescreen.Log2LogrusWriter{Entry: conf.Log.WithField("stdlog", "1")})
	log.SetFlags(0)
	smokescreen.StartWithConfig(conf, nil)
}
