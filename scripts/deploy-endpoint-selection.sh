#!/usr/bin/env bash

# Select the first endpoint for which the caller-provided probe_endpoint
# function succeeds.
#
# Exit codes:
#   0: a proven available endpoint was selected
#   2: all probes failed; required role retained its first candidate
#   3: all probes failed; optional role remains unbound
select_endpoint_for_role() {
  local requirement="$1"
  local chain="$2"
  local first=""
  local candidate=""

  for candidate in $chain; do
    if [ -z "$first" ]; then first="$candidate"; fi
    if probe_endpoint "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  if [ "$requirement" = "required" ]; then
    printf '%s\n' "$first"
    return 2
  fi
  return 3
}

# Assign a resolved endpoint name to the shell variable named by $1.
#
# `printf -v` stores the value as data, so an endpoint name that happens to
# contain shell metacharacters (command substitution, backticks, quotes) is
# never re-evaluated. The target name is checked against the shell identifier
# grammar so the assignment target itself cannot be injected either.
#
# Exit codes:
#   0: value assigned
#   1: rejected invalid variable name
assign_endpoint_var() {
  local target="$1"
  local value="$2"

  case "$target" in
    [!A-Za-z_]* | *[!A-Za-z0-9_]*)
      printf 'assign_endpoint_var: invalid variable name: %s\n' "$target" >&2
      return 1
      ;;
    "")
      printf 'assign_endpoint_var: missing variable name\n' >&2
      return 1
      ;;
  esac

  printf -v "$target" '%s' "$value"
}
